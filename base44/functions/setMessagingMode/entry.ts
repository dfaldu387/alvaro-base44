import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { normaliseAuPhone } from '../../shared/auPhone.ts';
import { ensureSettingsRow } from '../../shared/settingsStore.ts';
import { parseMode, allowlistSet } from '../../shared/messagingMode.ts';

/**
 * setMessagingMode — the ONLY place the messaging safety gate is changed.
 * A person (never automation) must call it.
 *
 *   body.mode               'off' | 'allowlist' | 'live'
 *   body.confirm_live       must be true to switch to 'live'
 *   body.allowlist_numbers  full replacement list of AU numbers (normalised and de-duplicated here)
 *
 * Every change writes an ActivityLog row with who and when. Switching to live
 * stamps went_live_at / went_live_by; if that record cannot be written the switch
 * is rolled back, so the app is never live without a record of who did it.
 * Phone numbers are never written to the activity log, only counts.
 */
const fail = (status: number, code: string, message: string) => Response.json({ ok: false, code, message }, { status });
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const view = (row: any) => ({
  messaging_mode: parseMode(row?.messaging_mode),
  allowlist_numbers: [...allowlistSet(row?.allowlist_numbers)],
  went_live_at: row?.went_live_at || null,
  went_live_by: row?.went_live_by || null,
});

async function audit(admin: any, who: string, action: string, previous: string, next: string, detail: string): Promise<boolean> {
  try {
    await admin.entities.ActivityLog.create({
      action, actor: 'barber', actor_type: 'admin', actor_name: who, outcome: 'applied',
      summary: `Messaging: ${detail}`, detail, previous_value: previous, new_value: next,
      timestamp: new Date().toISOString(),
    });
    return true;
  } catch (e) {
    console.error('[setMessagingMode] audit write failed', (e as Error)?.message);
    return false;
  }
}

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return fail(403, 'AUTOMATION_REFUSED', 'The messaging mode can only be changed by a person.');

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const admin = base44.asServiceRole;
    const who = actor.name;

    // The one settings row: created only when there is none, a racing create removes itself.
    const row = await ensureSettingsRow(admin, 'MessagingSettings', { messaging_mode: 'allowlist', allowlist_numbers: [] });

    const before = parseMode(row.messaging_mode);
    const update: Record<string, unknown> = {};
    const notes: string[] = [];

    if (body?.allowlist_numbers !== undefined) {
      if (!Array.isArray(body.allowlist_numbers)) return fail(400, 'INVALID_INPUT', 'allowlist_numbers must be a list.');
      const bad = body.allowlist_numbers.filter((n: unknown) => !normaliseAuPhone(n));
      if (bad.length > 0) return fail(400, 'INVALID_NUMBER', `${bad.length} number${bad.length === 1 ? ' is' : 's are'} not a valid Australian number.`);
      const list = [...new Set<string>(body.allowlist_numbers.map((n: unknown) => normaliseAuPhone(n) as string))];
      const old = allowlistSet(row.allowlist_numbers);
      if (list.length !== old.size || list.some(n => !old.has(n))) {
        update.allowlist_numbers = list;
        notes.push(`allowlist changed (${old.size} → ${list.length} numbers)`);
      }
    }

    let next = before;
    if (body?.mode !== undefined) {
      if (!['off', 'allowlist', 'live'].includes(body.mode)) return fail(400, 'INVALID_INPUT', 'mode must be off, allowlist or live.');
      next = body.mode;
      if (next === 'live' && before !== 'live' && body?.confirm_live !== true) {
        return fail(400, 'CONFIRM_REQUIRED', 'Switching to live means every customer will receive automated messages. Confirm to continue.');
      }
      if (next !== before) {
        update.messaging_mode = next;
        notes.push(`mode ${before} → ${next}`);
        if (next === 'live') { update.went_live_at = new Date().toISOString(); update.went_live_by = who; }
      }
    } else if (row.messaging_mode !== before) {
      // The stored value was missing or unknown: make the effective mode explicit.
      update.messaging_mode = before;
    }

    if (Object.keys(update).length === 0) return Response.json({ ok: true, changed: false, ...view(row), message: 'Nothing changed.' });

    const saved = await admin.entities.MessagingSettings.update(row.id, update);
    const detail = notes.join('; ') || 'mode made explicit';
    const recorded = await audit(admin, who, next === 'live' && before !== 'live' ? 'messaging_went_live' : 'messaging_mode_changed', before, next, `${detail} by ${who}`);
    if (!recorded && next === 'live' && before !== 'live') {
      await admin.entities.MessagingSettings.update(row.id, { messaging_mode: before });
      return fail(500, 'AUDIT_FAILED', 'The change could not be recorded, so it was not applied. Messaging stays as it was.');
    }
    return Response.json({ ok: true, changed: true, ...view({ ...row, ...update, ...(saved || {}) }), audit_recorded: recorded, message: `Saved: ${detail}.` });
  } catch (e) {
    console.error('[setMessagingMode] failed', (e as Error)?.message);
    return fail(500, 'ERROR', 'Could not change the messaging mode.');
  }
}