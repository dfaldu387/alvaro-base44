import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { getProvider, isLive, missingSecrets } from './sender.ts';
import { renderTemplate } from '../../shared/messageRender.ts';
import { quietHoursCheck } from '../../shared/messagingProtections.ts';
import { recipientBlock } from './guards.ts';
import { isCanonicalRow } from '../../shared/outboxCanonical.ts';
import { deliveryUpdate } from '../../shared/deliveryStatus.ts';
import { loadMessagingMode, modeBlock, type ModeConfig } from '../../shared/messagingMode.ts';
import { recordJobRun } from '../../shared/jobHeartbeat.ts';
import { ensureRouteTemplates } from '../../shared/routeMessageTemplates.ts';
import { runRunningLate, runningLateStale } from '../../shared/runningLate.ts';
import { LINK_TEMPLATES, resolveLinkMessage } from '../../shared/paymentMessages.ts';
import { getPaymentProvider } from '../../shared/paymentProvider.ts';

/**
 * processMessageOutbox — the background sweep over MessageOutbox.
 *
 * Sends through the provider adapter in sender.ts (Twilio SMS). "sent" means
 * the provider accepted the message; the Message row becomes "delivered" only
 * when the twilioStatusWebhook callback says so. Test data is suppressed
 * before the provider is reached.
 *
 * Authorisation: requireAdminActor. The platform's workflow runner invokes
 * functions with a service identity that resolves to admin (the same pattern
 * routeFlowAutoPlaceV2 relies on); an anonymous caller is refused with 401.
 *
 * Concurrency: a pending item is claimed with ONE conditional update
 * ({id, status:'pending'} -> claimed, stamped with this run's token). Only one
 * overlapping run can match that filter; the run then reads the row back and
 * proceeds only if the token is its own. Every later write is conditional on
 * the same token, so a run that lost its claim (stale recovery) cannot overwrite
 * the new owner.
 */

const BATCH_LIMIT = 25;
const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60];
const STALE_CLAIM_MINUTES = 10;

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const iso = (ms: number) => new Date(ms).toISOString();
const entry = (result: string, note: string) => ({ at: new Date().toISOString(), result, note });

const DEAD_REASON =
  'Gave up after 5 failed attempts. Check the last error, fix the cause, then re-queue it manually.';

/** One conditional write, only if this run still owns the claim. */
async function finish(admin: any, item: any, runId: string, set: Record<string, any>, extra: Record<string, any> = {}) {
  await admin.entities.MessageOutbox.updateMany(
    { id: item.id, status: 'claimed', claim_token: runId },
    { $set: { claim_token: null, ...set }, $push: { history: extra.history }, ...(extra.inc ? { $inc: extra.inc } : {}) },
  );
}

async function claim(admin: any, item: any, runId: string) {
  await admin.entities.MessageOutbox.updateMany(
    { id: item.id, status: 'pending' },
    { $set: { status: 'claimed', claimed_at: new Date().toISOString(), claim_token: runId } },
  );
  const fresh = await admin.entities.MessageOutbox.get(item.id);
  return fresh && fresh.status === 'claimed' && fresh.claim_token === runId ? fresh : null;
}

/** A failed (or lost) attempt: back off, or dead-letter at the limit. Returns true if dead-lettered. */
async function recordFailure(admin: any, item: any, runId: string, error: string) {
  const attempts = (Number(item.attempt_count) || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await finish(admin, item, runId, {
      status: 'dead_letter', attempt_count: attempts, last_error: error, dead_letter_reason: DEAD_REASON,
    }, { history: entry('dead_letter', `Attempt ${attempts} failed; no attempts left.`) });
    return true;
  }
  const delay = BACKOFF_MINUTES[attempts - 1];
  await finish(admin, item, runId, {
    status: 'pending', attempt_count: attempts, last_error: error,
    next_attempt_at: iso(Date.now() + delay * 60_000),
  }, { history: entry('failed', `Attempt ${attempts} failed; retry in ${delay} min.`) });
  return false;
}

/** A permanent failure: straight to dead_letter with the reason, never retried. */
async function deadLetterNow(admin: any, item: any, runId: string, reason: string) {
  const attempts = (Number(item.attempt_count) || 0) + 1;
  await finish(admin, item, runId, {
    status: 'dead_letter', attempt_count: attempts, last_error: reason, dead_letter_reason: reason,
  }, { history: entry('dead_letter', `Permanent failure on attempt ${attempts}; not retried.`) });
}

/** Items stuck in 'claimed' by a crashed run go back in the queue (counted as a lost attempt). */
async function recoverStale(admin: any) {
  const cutoff = iso(Date.now() - STALE_CLAIM_MINUTES * 60_000);
  const stale = asList(await admin.entities.MessageOutbox.filter(
    { status: 'claimed', claimed_at: { $lt: cutoff } }, 'claimed_at', BATCH_LIMIT,
  ));
  let recovered = 0;
  let dead = 0;
  for (const item of stale) {
    try {
      const attempts = (Number(item.attempt_count) || 0) + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      const res = await admin.entities.MessageOutbox.updateMany(
        { id: item.id, status: 'claimed', claimed_at: item.claimed_at },
        {
          $set: giveUp
            ? { status: 'dead_letter', attempt_count: attempts, claim_token: null, last_error: 'A processing run stopped before finishing this item.', dead_letter_reason: DEAD_REASON }
            : { status: 'pending', attempt_count: attempts, claim_token: null, next_attempt_at: new Date().toISOString(), last_error: 'A processing run stopped before finishing this item.' },
          $push: { history: entry(giveUp ? 'dead_letter' : 'recovered', 'Stale claim recovered.') },
        },
      );
      if (res === undefined || res === null || res.modified_count !== 0) {
        recovered++;
        if (giveUp) dead++;
      }
    } catch (e) {
      console.error('stale recovery failed for one item', (e as Error)?.message);
    }
  }
  return { recovered, dead };
}

/** One logical health row: oldest row wins, a racing duplicate is removed. */
async function getHealth(admin: any) {
  const rows = asList(await admin.entities.OutboxHealth.list('created_date', 10));
  if (rows.length > 0) return rows[0];
  const mine = await admin.entities.OutboxHealth.create({ consecutive_failures: 0, items_sent_last_run: 0, items_dead_lettered: 0 });
  await new Promise(r => setTimeout(r, 400));
  const after = asList(await admin.entities.OutboxHealth.list('created_date', 10));
  const survivor = after[0] || mine;
  if (survivor.id !== mine.id) {
    try { await admin.entities.OutboxHealth.delete(mine.id); } catch { /* survivor remains the only live row */ }
  }
  return survivor;
}

async function writeHealth(admin: any, health: any, data: Record<string, any>) {
  if (!health?.id) return false;
  try {
    await admin.entities.OutboxHealth.update(health.id, data);
    return true;
  } catch (e) {
    console.error('OutboxHealth update failed — health record is NOT current', (e as Error)?.message);
    return false;
  }
}

/**
 * Builds the final text from the item's template and payload and stores it as
 * rendered_text BEFORE any sending. A broken message is dead-lettered with the
 * reason and never reaches the sender. A deactivated template suppresses it.
 */
async function renderForItem(admin: any, item: any, runId: string): Promise<{ text?: string; outcome?: string }> {
  const key = String(item.template_key || '').trim();

  // An admin's typed message has no template: its text IS the payload. Only an
  // outbox row created by sendManualMessage (is_manual) may take this path.
  // Assistant replies are the same: the text is the payload, already checked by the
  // assistant's hard guard when it was queued (outbox rows can only be created server-side).
  if ((key === 'manual_message' && item.is_manual === true) || key === 'assistant_reply') {
    const typed = typeof item.payload?.text === 'string' ? item.payload.text.trim() : '';
    if (!typed) {
      await deadLetterNow(admin, item, runId, 'manual message has no text');
      return { outcome: 'dead_letter' };
    }
    await admin.entities.MessageOutbox.updateMany(
      { id: item.id, status: 'claimed', claim_token: runId },
      { $set: { rendered_text: typed } },
    );
    return { text: typed };
  }

  const template = key
    ? asList(await admin.entities.MessageTemplate.filter({ template_key: key }, 'created_date', 5))[0]
    : null;
  if (!template) {
    await deadLetterNow(admin, item, runId, `no message template found for "${key || '(none)'}"`);
    return { outcome: 'dead_letter' };
  }
  if (template.is_active === false) {
    await finish(admin, item, runId, { status: 'suppressed', suppressed_reason: 'template is switched off' },
      { history: entry('suppressed', 'Template is switched off — nothing sent.') });
    return { outcome: 'suppressed' };
  }
  if (template.channel && template.channel !== item.channel) {
    await deadLetterNow(admin, item, runId, `template "${key}" is written for ${template.channel}, not ${item.channel}`);
    return { outcome: 'dead_letter' };
  }
  const rendered = renderTemplate(template.body, item.payload);
  if (!rendered.ok) {
    await deadLetterNow(admin, item, runId, rendered.reason);
    return { outcome: 'dead_letter' };
  }
  // A payment text that does not carry its link is worthless (or promises one that never comes): never send it.
  if (LINK_TEMPLATES.includes(key) && !rendered.text.includes(String(item.payload?.payment_link || '\u0000'))) {
    await deadLetterNow(admin, item, runId, `the "${key}" wording has no {{payment_link}}, so the customer would have no way to pay. Add it to the template.`);
    return { outcome: 'dead_letter' };
  }
  await admin.entities.MessageOutbox.updateMany(
    { id: item.id, status: 'claimed', claim_token: runId },
    { $set: { rendered_text: rendered.text } },
  );
  return { text: rendered.text };
}

/** Process one claimed item. Returns what happened. */
async function processClaimed(admin: any, item: any, runId: string, cfg: ModeConfig) {
  // Test data is suppressed before the sender is ever reached.
  if (item.is_test === true) {
    await finish(admin, item, runId, { status: 'suppressed', suppressed_reason: 'test data' },
      { history: entry('suppressed', 'Test data — sender not invoked.') });
    return 'suppressed';
  }

  // Duplicate guard. Two simultaneous enqueues can briefly leave two rows for one
  // key; only the oldest may ever be sent. A row the provider has already accepted
  // is a resume, not a new send, so it is left alone.
  if (!item.provider_message_id && item.idempotency_key) {
    const siblings = asList(await admin.entities.MessageOutbox.filter({ idempotency_key: item.idempotency_key }, 'created_date', 20));
    if (!isCanonicalRow(item, siblings)) {
      await finish(admin, item, runId, { status: 'suppressed', suppressed_reason: 'duplicate of an earlier message with the same key' },
        { history: entry('suppressed', 'Duplicate outbox row for the same idempotency key — nothing sent.') });
      return 'suppressed';
    }
  }

  // Order is fixed: 1 test data (above and in the recipient check), 2 opt-out,
  // 3 messaging mode, 4 quiet hours.
  const block = await recipientBlock(admin, item);
  if (block) {
    await finish(admin, item, runId, { status: 'suppressed', suppressed_reason: block },
      { history: entry('suppressed', `Not sent: ${block}.`) });
    return 'suppressed';
  }

  // The messaging mode is the safety gate: off sends nothing, allowlist only the listed numbers.
  const gated = modeBlock(cfg, item);
  if (gated) {
    await finish(admin, item, runId, { status: 'suppressed', suppressed_reason: gated },
      { history: entry('suppressed', `Not sent: ${gated}.`) });
    return 'suppressed';
  }

  // A running-late apology is only worth sending while it is still true: not once the
  // barber has arrived, and not after the day is over (a retry or quiet-hours wait).
  if (item.template_key === 'running_late') {
    const stale = await runningLateStale(admin, item);
    if (stale) {
      await finish(admin, item, runId, { status: 'suppressed', suppressed_reason: stale },
        { history: entry('suppressed', `Not sent: ${stale}.`) });
      return 'suppressed';
    }
  }

  // Quiet hours defer, never discard. Admin-triggered manual sends are exempt.
  if (item.is_manual !== true) {
    const quiet = quietHoursCheck();
    if (quiet.quiet) {
      const reason = 'quiet hours (08:00–20:00 Australia/Sydney)';
      await finish(admin, item, runId,
        { status: 'pending', claimed_at: null, next_attempt_at: quiet.resumeAt, deferral_reason: `Held for ${reason}; resumes ${quiet.resumeAt}` },
        { history: entry('deferred', `Held for ${reason}. Rescheduled to ${quiet.resumeAt}.`) });
      return 'deferred';
    }
  }

  // A deposit or balance text is checked against the LIVE payment at the moment of sending, not when it was queued:
  // money no longer owing means no text; the amount and the payment link in it are brought up to date first.
  // This comes after the consent, mode and quiet-hours checks, so no link is made for a text that will not go out.
  if (LINK_TEMPLATES.includes(String(item.template_key)) && !item.provider_message_id) {
    const live = await resolveLinkMessage(admin, item, { provider: getPaymentProvider() });
    if (live.action === 'suppress') {
      await finish(admin, item, runId, { status: 'suppressed', suppressed_reason: live.reason },
        { history: entry('suppressed', `Not sent: ${live.reason}.`) });
      return 'suppressed';
    }
    if (live.action === 'fail') {
      await deadLetterNow(admin, item, runId, `The payment link could not be made. ${live.reason}`);
      return 'dead_letter';
    }
    if (live.action === 'retry') {
      const dead = await recordFailure(admin, item, runId, `The payment link could not be made. ${live.reason}`);
      return dead ? 'dead_letter' : 'failed';
    }
    item = { ...item, payload: live.payload };
    await admin.entities.MessageOutbox.updateMany({ id: item.id, status: 'claimed', claim_token: runId }, { $set: { payload: live.payload } });
  }

  // The Message record needs a client; fall back to the booking's client.
  let clientId = item.client_id || null;
  if (!clientId && item.booking_request_id) {
    try { clientId = (await admin.entities.BookingRequest.get(item.booking_request_id))?.client_id || null; } catch { clientId = null; }
  }
  if (!clientId) {
    const dead = await recordFailure(admin, item, runId, 'No client is linked, so a Message record cannot be created.');
    return dead ? 'dead_letter' : 'failed';
  }

  // If the provider already accepted this item in an earlier run (the worker
  // died before finishing), it is NOT sent again — only the bookkeeping resumes.
  let sid: string | null = item.provider_message_id || null;
  let text: string = item.rendered_text || '';
  if (!sid) {
    const rendered = await renderForItem(admin, item, runId);
    if (rendered.outcome) return rendered.outcome;
    item = { ...item, rendered_text: rendered.text };

    const provider = getProvider(item.channel);
    if (!provider) {
      await deadLetterNow(admin, item, runId, `No provider is set up for the "${item.channel}" channel.`);
      return 'dead_letter';
    }
    const result = await provider.send(item);
    if (!result.ok) {
      if (!result.retryable) {
        await deadLetterNow(admin, item, runId, result.error || 'Permanent provider failure.');
        return 'dead_letter';
      }
      const dead = await recordFailure(admin, item, runId, result.error || 'Provider failure.');
      return dead ? 'dead_letter' : 'failed';
    }
    sid = result.providerMessageId;
    text = result.text;
    // Record the provider id immediately, before anything else can fail.
    await admin.entities.MessageOutbox.updateMany(
      { id: item.id, status: 'claimed', claim_token: runId },
      { $set: { provider_message_id: sid } },
    );
  }

  const simulated = String(sid).startsWith('SIMULATED-');

  // Idempotent: a Message already made for this item is reused, never duplicated.
  const existing = asList(await admin.entities.Message.filter({ outbox_id: item.id }, 'created_date', 1));
  const message = existing[0] || await admin.entities.Message.create({
    client_id: clientId,
    booking_request_id: item.booking_request_id || undefined,
    direction: 'outgoing',
    message_text: text,
    message_type: item.channel,
    manual_or_automated: item.is_manual === true ? 'manual' : 'automated',
    delivery_status: 'sent',
    sent_date: new Date().toISOString(),
    simulated,
    outbox_id: item.id,
    provider_message_id: sid,
  });

  // A status callback may have beaten the Message: it was kept on the outbox row.
  // Read it back AFTER the Message exists so neither order can lose it.
  if (!simulated) {
    const fresh = await admin.entities.MessageOutbox.get(item.id).catch(() => null);
    const upd = deliveryUpdate(fresh?.provider_delivery_status, fresh?.provider_error_code);
    if (upd) await admin.entities.Message.updateMany({ id: message.id, delivery_status: { $in: upd.from } }, { $set: upd.set });
  }

  await finish(admin, item, runId, {
    status: 'sent', message_id: message.id, rendered_text: text, provider_message_id: sid, last_error: null,
  }, { history: entry('sent', simulated
    ? 'SIMULATED send — nothing was delivered to anyone.'
    : 'Accepted by the provider. Delivery is confirmed separately by the status callback.') });
  return 'sent';
}

export default async function (req: Request) {
  let admin: any;
  let scheduled = false;
  try {
    const base44 = createClientFromRequest(req);
    admin = base44.asServiceRole;
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    scheduled = actor.automation === true;
  } catch {
    return Response.json({ ok: false, error: 'Could not start the sweep.' }, { status: 500 });
  }

  const runId = crypto.randomUUID();
  let health: any = null;
  try {
    health = await getHealth(admin);
    await writeHealth(admin, health, { last_run_at: new Date().toISOString() });
  } catch (e) {
    console.error('OutboxHealth unavailable at run start', (e as Error)?.message);
  }

  // Stop loudly if the provider is not configured — visible on the admin monitor.
  const missing = missingSecrets();
  if (missing.length > 0) {
    const message = `Messaging is not configured. Missing secret(s): ${missing.join(', ')}. Add them in the app's Secrets, then run the sweep again.`;
    console.error(message);
    const healthUpdated = await writeHealth(admin, health, {
      consecutive_failures: (Number(health?.consecutive_failures) || 0) + 1,
      items_sent_last_run: 0,
      last_error: message,
    });
    if (scheduled) await recordJobRun(admin, 'sweep', { outcome: 'failed', error: message, reason: 'The provider is not configured, so nothing was processed.' });
    return Response.json({ ok: false, error: message, missing_secrets: missing, health_updated: healthUpdated }, { status: 503 });
  }

  try {
    const stale = await recoverStale(admin);
    // Read once per run; if it cannot be read the sweep fails rather than sending on a guess.
    const cfg = await loadMessagingMode(admin);

    // Same cadence, same function: make sure the route templates exist, then queue any
    // "running late" messages the live ETA calls for. Neither may ever stop the sweep.
    let lateQueued = 0;
    try { await ensureRouteTemplates(admin); } catch (e) { console.error('route templates check failed', (e as Error)?.message); }
    try { lateQueued = (await runRunningLate(admin)).queued; } catch (e) { console.error('running-late check failed', (e as Error)?.message); }

    const due = asList(await admin.entities.MessageOutbox.filter(
      { status: 'pending', next_attempt_at: { $lte: new Date().toISOString() } }, 'next_attempt_at', BATCH_LIMIT,
    )).slice(0, BATCH_LIMIT);

    const tally = { claimed: 0, sent: 0, suppressed: 0, deferred: 0, failed: 0, dead_lettered: stale.dead, skipped_lost_claim: 0, errors: 0 };

    for (const candidate of due) {
      let item: any = null;
      try {
        item = await claim(admin, candidate, runId);
        if (!item) { tally.skipped_lost_claim++; continue; }
        tally.claimed++;
        const outcome = await processClaimed(admin, item, runId, cfg);
        if (outcome === 'sent') tally.sent++;
        else if (outcome === 'suppressed') tally.suppressed++;
        else if (outcome === 'deferred') tally.deferred++;
        else if (outcome === 'dead_letter') tally.dead_lettered++;
        else tally.failed++;
      } catch (e) {
        // One bad record never stops the batch; a claim left behind is recovered later.
        tally.errors++;
        console.error('outbox item failed', candidate?.id, (e as Error)?.message);
        if (item) {
          try {
            const dead = await recordFailure(admin, item, runId, 'Unexpected error while processing this item.');
            if (dead) tally.dead_lettered++;
          } catch { /* stale recovery will pick it up */ }
        }
      }
    }

    const healthUpdated = await writeHealth(admin, health, {
      last_successful_at: new Date().toISOString(),
      consecutive_failures: 0,
      items_sent_last_run: tally.sent,
      items_dead_lettered: (Number(health?.items_dead_lettered) || 0) + tally.dead_lettered,
      last_error: '',
    });

    if (scheduled) {
      const failedCount = tally.failed + tally.dead_lettered + tally.errors;
      await recordJobRun(admin, 'sweep', {
        outcome: tally.claimed > 0 || stale.recovered > 0 || lateQueued > 0 ? 'acted' : 'no_op',
        reason: tally.claimed > 0 ? '' : 'Nothing was due in the queue.',
        detail: `Messaging mode ${cfg.mode}${tally.deferred ? ` · ${tally.deferred} held for quiet hours` : ''}${stale.recovered ? ` · ${stale.recovered} stale claims recovered` : ''}${lateQueued ? ` · ${lateQueued} running-late queued` : ''}`,
        processed: tally.claimed, sent: tally.sent, suppressed: tally.suppressed, failed: failedCount,
      });
    }

    console.log(JSON.stringify({ event: 'outbox_sweep_done', run_id: runId, mode: cfg.mode, ...tally, recovered_stale: stale.recovered }));
    return Response.json({
      ok: true, simulated: !isLive(), run_id: runId,
      ...tally, recovered_stale: stale.recovered, health_updated: healthUpdated,
    });
  } catch (e) {
    console.error('outbox sweep failed', (e as Error)?.message);
    const healthUpdated = await writeHealth(admin, health, {
      consecutive_failures: (Number(health?.consecutive_failures) || 0) + 1,
      items_sent_last_run: 0,
      last_error: 'The last sweep failed before it could finish. See the function logs.',
    });
    if (scheduled) await recordJobRun(admin, 'sweep', { outcome: 'failed', error: 'The sweep failed before it could finish. See the function logs.' });
    return Response.json({ ok: false, error: 'Sweep failed.', health_updated: healthUpdated }, { status: 500 });
  }
}