import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { normaliseAuPhone } from '../../shared/auPhone.ts';
import {
  PROTECTION_DEFAULTS, resolveProtectionRules, evaluateProtection, implausibleContact, sameRequest,
  type Signals,
} from '../../shared/bookingProtection.ts';
import { isLateCancellation } from '../../shared/clientHistory.ts';
import { isTestLastName } from '../../shared/testData.ts';

/** Read-only, admin-only self-test of the booking protection rules. Writes nothing. */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const results: { name: string; ok: boolean; detail?: string }[] = [];
    const check = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, detail: ok ? undefined : detail });
    const clean: Signals = { phoneHour: 0, emailHour: 0, ipHour: 0, activeUnconfirmed: 0, distinctNamesDay: 1, declinedRepeatHoursAgo: null };
    const goodContact = { name: 'Sam Carter', phone: '0423 871 596', email: 'sam@example.com' };
    const loc = { tier: 'priority', distanceKm: 3 };
    const run = (rulesOver: any, sig: Partial<Signals>, contact: any = goodContact, location: any = loc) =>
      evaluateProtection({ rules: resolveProtectionRules(rulesOver), signals: { ...clean, ...sig }, contact, location });

    // Configurable rules
    const d = resolveProtectionRules(null);
    check('defaults are the documented starting values', d.max_per_phone_hour === 10 && d.max_active_unconfirmed === 3 && d.max_per_ip_hour === 20, JSON.stringify(d));
    check('saved values override defaults', resolveProtectionRules({ max_per_phone_hour: 4 }).max_per_phone_hour === 4);
    check('negative or non-number values are ignored', resolveProtectionRules({ max_per_phone_hour: -5, max_per_email_hour: 'x' }).max_per_phone_hour === PROTECTION_DEFAULTS.max_per_phone_hour);

    // Phone matching is by the shared helper
    const variants = ['0412 345 678', '0412-345-678', '+61 412 345 678', '61412345678', '(04) 1234 5678'].map(normaliseAuPhone);
    check('every phone format becomes one key', variants.every((v) => v === '0412345678'), JSON.stringify(variants));

    // Fifteen submissions from one number: first ten pass, the rest are held with a reason
    const relaxed = { max_active_unconfirmed: 0 };
    const outcomes = Array.from({ length: 15 }, (_, i) => run(relaxed, { phoneHour: i }));
    check('submissions 1-10 are not held', outcomes.slice(0, 10).every((o) => !o.hold));
    check('submissions 11-15 are held, each with a readable reason', outcomes.slice(10).every((o, i) => o.hold && o.reasons[0] === `${11 + i} requests from this number in the last hour (limit 10).`), JSON.stringify(outcomes[10]));
    check('a hold never rejects: result has reasons, no error', outcomes[10].reasons.length === 1 && outcomes[10].codes[0] === 'rate_phone');

    // Genuine family / group
    check('a group booking is one submission and is not held', !run({}, { phoneHour: 0 }).hold);
    check('a family of 3 separate bookings is not held (default active limit 3)', !run({}, { phoneHour: 2, activeUnconfirmed: 2 }).hold);
    check('the 4th open unconfirmed booking is held with a reason', run({}, { activeUnconfirmed: 3 }).codes.join() === 'active_limit');

    // Each suspicious pattern has its own reason and code
    check('email rate limit', run({}, { emailHour: 10 }).codes.join() === 'rate_email');
    check('network rate limit', run({}, { ipHour: 20 }).codes.join() === 'rate_ip');
    check('many names on one phone', run({}, { distinctNamesDay: 6 }).codes.join() === 'many_names');
    check('outer-ring address', run({}, {}, goodContact, { tier: 'outer', distanceKm: 41.2 }).codes.join() === 'far_address');
    check('exact repeat of a declined request', run({}, { declinedRepeatHoursAgo: 3 }).codes.join() === 'repeat_declined');
    check('impossible phone', run({}, {}, { ...goodContact, phone: '0400000000' }).codes.join() === 'bad_contact');
    check('impossible email', implausibleContact({ ...goodContact, email: 'not-an-email' }).length === 1);
    check('impossible name', implausibleContact({ ...goodContact, name: 'x' }).length === 1);
    check('a real customer has no contact flags', implausibleContact(goodContact).length === 0);

    // The explicit internal QA marker: a surname of exactly TEST (case-sensitive)
    check('TEST is case-sensitive: Test and test are ordinary names',
      isTestLastName('Moey - TEST') && !isTestLastName('Moey - Test') && !isTestLastName('Moey - test'));
    check('a TEST surname is never judged for name quality', implausibleContact({ ...goodContact, name: 'Moey - TEST' }).length === 0);
    check('a TEST booking is still checked for everything else', implausibleContact({ ...goodContact, name: 'Moey - TEST', phone: '0000000000' }).length === 1);
    check('a suspicious name that is not TEST is still flagged', implausibleContact({ ...goodContact, name: '---' }).length === 1);

    // Switches
    check('master switch off holds nothing', !run({ enabled: false }, { phoneHour: 50, activeUnconfirmed: 9 }).hold);
    check('a limit of 0 turns just that check off', !run({ max_per_phone_hour: 0 }, { phoneHour: 50 }).hold);

    // Repeat matching
    const a = { requested_date: '2026-10-16', availability_window: '2pm - 7pm', services: ['Haircut', 'Beard'], address: '1 Main St' };
    check('sameRequest ignores case, spacing and order', sameRequest(a, { ...a, availability_window: '2PM-7PM', services: ['beard', 'haircut'], address: '1  main st' }));
    check('sameRequest sees a different date', !sameRequest(a, { ...a, requested_date: '2026-10-17' }));

    // Late cancellation
    const b = { requested_date: '2026-10-16', assigned_time: '10:00am' };
    check('cancelled 19h before is late (24h window)', isLateCancellation({ ...b, declined_at: '2026-10-15T04:00:00Z' }, 24));
    check('cancelled 2 days before is not late', !isLateCancellation({ ...b, declined_at: '2026-10-13T23:00:00Z' }, 24));
    check('cancelled before any time was assigned is not late', !isLateCancellation({ requested_date: '2026-10-16', declined_at: '2026-10-15T04:00:00Z' }, 24));

    const failed = results.filter((r) => !r.ok);
    return Response.json({ total: results.length, passed: results.length - failed.length, failed });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}