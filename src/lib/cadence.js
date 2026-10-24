// Frontend copy of the explanation rules in base44/shared/cadence.ts (the frontend cannot import from
// base44/). tests/cadence.test.mjs checks both give the same words, so they cannot drift apart.
const MIN_VISITS = 4;
const FREQUENCY_DAYS = { Weekly: 7, Fortnightly: 14, 'Every 3 weeks': 21, Monthly: 30 };

const storedSource = (c) => {
  const s = c?.cadence_source;
  if (s === 'manual' || s === 'observed' || s === 'default') return s;
  return c?.frequency && c.frequency !== 'Monthly' ? 'manual' : 'unknown';
};
const labelDays = (c) => (c?.frequency === 'Custom' ? Number(c.custom_frequency_days) || 0 : FREQUENCY_DAYS[c?.frequency] || 0);
const labelText = (c) => (c?.frequency === 'Custom' ? `every ${Number(c.custom_frequency_days) || '?'} days` : String(c?.frequency || 'no frequency'));

export function explainCadence(client) {
  const src = storedSource(client);
  const m = Number(client?.cadence_interval_days);
  const visits = Number(client?.cadence_visit_count) || 0;
  const measured = m > 0 && visits >= MIN_VISITS ? m : null;
  const ld = labelDays(client);
  const label = labelText(client);
  const source = (src === 'observed' || src === 'default') && measured ? 'observed' : src === 'observed' ? 'default' : src;
  const measuredText = measured ? `about every ${measured} days, from ${visits} visits` : '';
  const differs = !!measured && measured !== ld;
  let text;
  if (source === 'observed') text = `Comes in ${measuredText}.${ld ? ` (Label says ${label}.)` : ''}`;
  else if (source === 'manual') text = measured && differs ? `Set to ${label} by you. Visits suggest ${measuredText}.` : `Set to ${label} by you.`;
  else if (source === 'unknown') text = measured ? `Using ${label}, which is not confirmed as your choice. Visits suggest ${measuredText}.` : `Not enough history, using ${label}.`;
  else text = `Not enough history, using ${label}.`;
  return { text, source, measured_days: measured, visits, label, label_days: ld, differs, can_accept: !!measured && (source !== 'manual' || differs) };
}