import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { classifyReply, quietHoursCheck } from '../../shared/messagingProtections.ts';
import { computeTwilioSignature, verifyTwilioSignature } from '../../shared/twilio.ts';
import { modeBlock, parseMode, allowlistSet } from '../../shared/messagingMode.ts';

/**
 * messagingProtectionsSelfTest — admin-only. Runs the pure protection logic
 * (reply keywords, Sydney quiet hours, Twilio signature check with a made-up
 * token) in the real runtime. Reads and writes nothing.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const results: { name: string; pass: boolean; got?: unknown }[] = [];
    const check = (name: string, got: unknown, want: unknown) =>
      results.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), got });

    for (const w of ['STOP', ' stop ', 'StopAll', 'unsubscribe', 'end', 'Quit']) check(`opt_out: "${w}"`, classifyReply(w), 'opt_out');
    // CANCEL is not an opt-out: it only flags the booking for a human.
    check('CANCEL is not an opt-out', classifyReply('CANCEL'), 'other');
    for (const w of ['START', ' start\n', 'Unstop']) check(`opt_in: "${w}"`, classifyReply(w), 'opt_in');
    for (const w of ['please stop', 'stop it', 'YES', 'NO', '', 'stopp', 'Thanks!']) check(`other: "${w}"`, classifyReply(w), 'other');
    check('non-string body', classifyReply(undefined), 'other');

    const q = (iso: string) => { const v = quietHoursCheck(new Date(iso)); return v.quiet ? v.resumeAt : 'open'; };
    check('21:00 Sydney (Oct, AEDT) -> next 08:00', q('2026-10-13T10:00:00Z'), '2026-10-13T21:00:00.000Z');
    check('03:00 Sydney -> same-day 08:00', q('2026-10-12T16:00:00Z'), '2026-10-12T21:00:00.000Z');
    check('12:00 Sydney open', q('2026-10-13T01:00:00Z'), 'open');
    check('19:59 Sydney open', q('2026-10-13T08:59:00Z'), 'open');
    check('20:00 Sydney quiet', q('2026-10-13T09:00:00Z'), '2026-10-13T21:00:00.000Z');
    check('08:00 Sydney open', q('2026-10-12T21:00:00Z'), 'open');
    check('07:59 Sydney quiet', q('2026-10-12T20:59:00Z'), '2026-10-12T21:00:00.000Z');
    check('20:00 Sydney winter (AEST)', q('2026-07-13T10:00:00Z'), '2026-07-13T22:00:00.000Z');
    check('night DST starts (Sat 21:00 AEST -> Sun 08:00 AEDT)', q('2026-10-03T11:00:00Z'), '2026-10-03T21:00:00.000Z');
    check('night DST ends (Sat 21:00 AEDT -> Sun 08:00 AEST)', q('2027-04-03T10:00:00Z'), '2027-04-03T22:00:00.000Z');

    // Messaging mode gate: off / allowlist / live, formatting-insensitive, fail-safe default.
    const list = allowlistSet(['0412 345 678', '+61 400 111 222']);
    const cfg = (mode: any) => ({ mode: parseMode(mode), allowlist: list });
    const sms = (to: string) => ({ channel: 'sms', to_address: to });
    check('mode off blocks an allowlisted number', modeBlock(cfg('off'), sms('0412345678')), 'messaging is switched off');
    check('allowlist passes 0412345678', modeBlock(cfg('allowlist'), sms('0412345678')), null);
    check('allowlist passes +61412345678 (format differs)', modeBlock(cfg('allowlist'), sms('+61412345678')), null);
    check('allowlist passes 0400 111 222', modeBlock(cfg('allowlist'), sms('0400 111 222')), null);
    check('allowlist blocks another number', modeBlock(cfg('allowlist'), sms('0499999999')), 'not on the messaging allowlist');
    check('allowlist blocks an unparseable number', modeBlock(cfg('allowlist'), sms('abc')), 'not on the messaging allowlist');
    check('allowlist blocks email', modeBlock(cfg('allowlist'), { channel: 'email', to_address: 'a@b.co' }), 'not on the messaging allowlist');
    check('live allows anyone', modeBlock(cfg('live'), sms('0499999999')), null);
    check('missing mode defaults to allowlist', parseMode(undefined), 'allowlist');
    check('unknown mode defaults to allowlist', parseMode('LIVE!'), 'allowlist');

    const url = 'https://example.test/hook';
    const params = { From: '+61400000000', Body: 'STOP', MessageSid: 'SMtest' };
    const sig = await computeTwilioSignature('test-token', url, params);
    check('valid signature accepted', await verifyTwilioSignature('test-token', sig, [url], params), true);
    check('tampered body rejected', await verifyTwilioSignature('test-token', sig, [url], { ...params, Body: 'START' }), false);
    check('wrong token rejected', await verifyTwilioSignature('other-token', sig, [url], params), false);
    check('missing header rejected', await verifyTwilioSignature('test-token', null, [url], params), false);
    check('wrong url rejected', await verifyTwilioSignature('test-token', sig, ['https://example.test/other'], params), false);

    return Response.json({ ok: results.every(r => r.pass), passed: results.filter(r => r.pass).length, total: results.length, failures: results.filter(r => !r.pass) });
  } catch (e) {
    return Response.json({ error: 'Self-test failed to run.', detail: (e as Error)?.message }, { status: 500 });
  }
}