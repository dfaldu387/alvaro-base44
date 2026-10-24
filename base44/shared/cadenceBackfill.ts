import { cadencePatch, resolveCadence, addDaysYmd, storedSource } from './cadence.ts';
import { tzNow } from './campaignRules.ts';

/**
 * One-off measurement of every existing client. SENDS NOTHING: it only reads bookings and writes the
 * cadence fields (and, where the date was clearly derived from the label, next_reminder_date).
 *
 *   apply=false  preview: the same report, nothing written. Shows who becomes due sooner or later.
 *   apply=true   writes. Safe to run twice: a second run finds nothing to change.
 *
 * A client's reminder date is only moved when it is missing or exactly equals last visit + the cadence in
 * use before this run, i.e. the system derived it. A date a person set by hand is left alone.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function pageAll(fetchPage: (cursor?: string) => Promise<any>): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await fetchPage(cursor);
    out.push(...asList(page));
    if (!page?.has_more || !page?.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

export interface BackfillReport {
  applied: boolean; total: number;
  measured: number; lacked_history: number; left_alone_manual: number; ambiguous_not_used: number; skipped_test: number;
  records_written: number; dates_sooner: number; dates_later: number; dates_newly_set: number; dates_left_alone: number; becoming_due_now: number;
  changes: Array<{ id: string; name: string; from: string | null; to: string; days_before: number; days_after: number }>;
}

export async function runCadenceBackfill(admin: any, opts: { apply: boolean; monthlyIsDefault?: boolean; now?: Date }): Promise<BackfillReport> {
  const now = opts.now || new Date();
  const today = tzNow('Australia/Sydney', now).date;
  const clients = await pageAll(c => admin.entities.ReminderClient.filter({}, { sort: 'created_date', limit: 500, cursor: c }));
  const byClient = new Map<string, any[]>();
  for (const part of chunk(clients.map(c => c.id), 50)) {
    const rows = asList(await admin.entities.BookingRequest.filter({ client_id: { $in: part }, status: 'completed' }, { limit: 2000 }));
    for (const b of rows) { const l = byClient.get(b.client_id) || []; l.push(b); byClient.set(b.client_id, l); }
  }

  const r: BackfillReport = {
    applied: opts.apply, total: clients.length, measured: 0, lacked_history: 0, left_alone_manual: 0, ambiguous_not_used: 0, skipped_test: 0,
    records_written: 0, dates_sooner: 0, dates_later: 0, dates_newly_set: 0, dates_left_alone: 0, becoming_due_now: 0, changes: [],
  };
  const writes: Array<{ id: string; patch: Record<string, any> }> = [];

  for (const c of clients) {
    if (c.is_test === true) { r.skipped_test++; continue; }
    const { patch, measurement } = cadencePatch(c, byClient.get(c.id) || [], now.toISOString(), { monthlyIsDefault: opts.monthlyIsDefault });
    const src = storedSource(c, { monthlyIsDefault: opts.monthlyIsDefault });
    if (src === 'manual') r.left_alone_manual++;
    else if (src === 'unknown') r.ambiguous_not_used++;
    else if (measurement?.days) r.measured++;
    else r.lacked_history++;

    const before = resolveCadence(c);
    const after = resolveCadence({ ...c, ...patch });
    const last = YMD.test(String(c.last_visit_date || '')) ? String(c.last_visit_date) : null;
    if (after.source === 'observed' && last && after.days > 0) {
      const to = addDaysYmd(last, after.days);
      const cur = c.next_reminder_date ? String(c.next_reminder_date) : null;
      if (cur !== to) {
        const derived = !cur || (before.days > 0 && cur === addDaysYmd(last, before.days));
        if (!derived) r.dates_left_alone++;
        else {
          patch.next_reminder_date = to;
          if (!cur) r.dates_newly_set++; else if (to < cur) r.dates_sooner++; else r.dates_later++;
          if (to <= today && (!cur || cur > today)) r.becoming_due_now++;
          if (r.changes.length < 40) r.changes.push({ id: c.id, name: c.client_name || 'Unnamed client', from: cur, to, days_before: before.days, days_after: after.days });
        }
      }
    }
    if (Object.keys(patch).length) writes.push({ id: c.id, patch });
  }

  if (opts.apply) {
    for (const part of chunk(writes, 10)) await Promise.all(part.map(w => admin.entities.ReminderClient.update(w.id, w.patch)));
    r.records_written = writes.length;
  }
  return r;
}