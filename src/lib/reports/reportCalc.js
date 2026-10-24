import { differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns';

// Pure calculation of the business report from stored records. Nothing here
// changes how routes or prices are produced: it only reads their output.
// Every figure carries the rows behind it so it can be checked.

const FREQ_DAYS = { Weekly: 7, Fortnightly: 14, 'Every 3 weeks': 21, Monthly: 30 };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (n) => Math.round(n * 10) / 10;
const WORKING = ['completed', 'confirmed'];

export const fmtMoney = (n) => (n == null ? '—' : `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export function fmtMins(m) {
  if (m == null) return '—';
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)}h ${r % 60}m` : `${r}m`;
}
const shortDate = (d) => (d ? format(parseISO(d), 'EEE d MMM') : '');

function bookingRow(b, amount, source) {
  return {
    key: b.id, date: b.requested_date, title: b.client_name || 'Client',
    subtitle: `${shortDate(b.requested_date)} · ${(b.services || []).join(', ') || 'No service listed'}${source ? ` · ${source}` : ''}`,
    value: amount == null ? 'no price' : fmtMoney(amount),
  };
}

function bucketKey(dateStr, monthly) {
  const d = parseISO(dateStr);
  return monthly ? format(d, 'yyyy-MM') : format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}
const bucketLabel = (key, monthly) => (monthly ? format(parseISO(`${key}-01`), 'MMM yyyy') : `Wk ${format(parseISO(key), 'd MMM')}`);

export function computeReport({ bookings, payments, dayRoutes, logs, priorClientIds, regulars, from, to, today }) {
  const payMap = new Map(payments.map((p) => [p.booking_request_id, p]));
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const completed = bookings.filter((b) => b.status === 'completed' && b.requested_date);
  const monthly = differenceInCalendarDays(parseISO(to), parseISO(from)) > 62;

  // ── Money: payment amount where one was received, else the booking price ──
  const priced = [];
  const unpriced = [];
  completed.forEach((b) => {
    const p = payMap.get(b.id);
    const paid = p && num(p.amount_paid) > 0 ? p.amount_paid : null;
    const amount = paid ?? num(b.price);
    if (amount == null) { unpriced.push(b); return; }
    priced.push({ b, amount, source: paid != null ? 'payment received' : 'booking price' });
  });
  const revenue = priced.reduce((s, x) => s + x.amount, 0);
  const revenueRows = priced.map((x) => bookingRow(x.b, x.amount, x.source));
  const unpricedRows = unpriced.map((b) => bookingRow(b, null));

  // ── Finalised routes: the only source of drive and idle time ──
  const finalised = dayRoutes.filter((r) => r.route_status === 'finalised');
  const staleRoutes = dayRoutes.filter((r) => r.route_status === 'needs_update');
  const finalisedDates = new Set(finalised.map((r) => r.date));
  const workingDates = [...new Set(bookings.filter((b) => WORKING.includes(b.status) && b.assigned_time).map((b) => b.requested_date))].sort();
  const notFinalisedDates = workingDates.filter((d) => !finalisedDates.has(d) && d <= today);
  const staleDates = new Set(staleRoutes.map((r) => r.date));
  const notFinalisedRows = notFinalisedDates.map((d) => ({
    key: d, date: d, title: shortDate(d),
    subtitle: staleDates.has(d) ? 'Route was finalised, then the day changed (needs update)' : 'No route was finalised for this day',
    value: `${bookings.filter((b) => b.requested_date === d && WORKING.includes(b.status) && b.assigned_time).length} bookings`,
  }));

  const days = finalised.map((r) => {
    const stops = [...(r.stops || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const cut = stops.reduce((s, st) => s + (num(byId.get(st.booking_request_id)?.duration_mins) || 0), 0);
    const drive = num(r.drive_minutes) ?? 0;
    const idle = num(r.idle_minutes) ?? 0;
    const worked = cut + drive + idle;
    return { route: r, stops, cut, drive, idle, worked, ratio: worked ? cut / worked : null };
  });
  const sum = (k) => days.reduce((s, d) => s + d[k], 0);
  const cutMin = sum('cut'); const driveMin = sum('drive'); const idleMin = sum('idle');
  const workedMin = cutMin + driveMin + idleMin;
  const dayRows = days.map((d) => ({
    key: d.route.id, date: d.route.date, title: `${shortDate(d.route.date)}${d.route.team_member_name ? ` · ${d.route.team_member_name}` : ''}`,
    subtitle: `Cutting ${fmtMins(d.cut)} · Driving ${fmtMins(d.drive)} · Idle ${fmtMins(d.idle)}`,
    value: d.ratio == null ? '—' : `${Math.round(d.ratio * 100)}% earning`,
  }));

  // Revenue per working hour only counts completed bookings on days whose time is known.
  const revOnFinalised = priced.filter((x) => finalisedDates.has(x.b.requested_date));
  const revFinalised = revOnFinalised.reduce((s, x) => s + x.amount, 0);
  const revPerHour = workedMin > 0 && revOnFinalised.length ? revFinalised / (workedMin / 60) : null;

  // ── Trend ──
  const buckets = new Map();
  const bucketOf = (dateStr) => {
    const k = bucketKey(dateStr, monthly);
    if (!buckets.has(k)) buckets.set(k, { key: k, label: bucketLabel(k, monthly), revenue: 0, count: 0, rows: [], workedMin: 0, revFin: 0 });
    return buckets.get(k);
  };
  priced.forEach((x) => {
    const b = bucketOf(x.b.requested_date);
    b.revenue += x.amount; b.count += 1; b.rows.push(bookingRow(x.b, x.amount, x.source));
    if (finalisedDates.has(x.b.requested_date)) b.revFin += x.amount;
  });
  days.forEach((d) => { bucketOf(d.route.date).workedMin += d.worked; });
  const trend = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({
    ...b, revenue: Math.round(b.revenue * 100) / 100,
    avg: b.count ? b.revenue / b.count : null,
    perHour: b.workedMin > 0 && b.revFin > 0 ? b.revFin / (b.workedMin / 60) : null,
  }));

  // ── Route efficiency ──
  const legs = [];
  days.forEach((d) => d.stops.forEach((st, i) => {
    const m = num(st.drive_minutes);
    if (i >= d.stops.length - 1 || m == null) return;
    const next = d.stops[i + 1];
    legs.push({
      date: d.route.date, minutes: m,
      from: byId.get(st.booking_request_id)?.client_name || 'Stop', to: byId.get(next.booking_request_id)?.client_name || 'Stop',
    });
  }));
  const legRows = (arr) => arr.map((l, i) => ({ key: `${l.date}-${i}-${l.from}`, date: l.date, title: `${l.from} → ${l.to}`, subtitle: shortDate(l.date), value: fmtMins(l.minutes) }));
  const worstLegs = [...legs].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
  const stopCount = days.reduce((s, d) => s + d.stops.length, 0);

  const routeIds = new Set(finalised.map((r) => r.id));
  const logsByRoute = new Map();
  [...logs].sort((a, b) => String(a.created_date).localeCompare(String(b.created_date))).forEach((l) => {
    if (!routeIds.has(l.related_record_id)) return;
    (logsByRoute.get(l.related_record_id) || logsByRoute.set(l.related_record_id, []).get(l.related_record_id)).push(l);
  });
  const savings = [];
  logsByRoute.forEach((ls, routeId) => {
    const first = ls[0]; const last = ls[ls.length - 1];
    const dB = num(first.drive_minutes_before); const iB = num(first.idle_minutes_before);
    const dA = num(last.drive_minutes_after); const iA = num(last.idle_minutes_after);
    if (dB == null || iB == null || dA == null || iA == null) return;
    const r = finalised.find((x) => x.id === routeId);
    savings.push({ date: r.date, name: r.team_member_name, dB, iB, dA, iA });
  });
  const savingRows = savings.map((s) => ({
    key: `${s.date}-${s.name}`, date: s.date, title: `${shortDate(s.date)}${s.name ? ` · ${s.name}` : ''}`,
    subtitle: `Drive ${s.dB} → ${s.dA} min · Idle ${s.iB} → ${s.iA} min`, value: `${fmtMins(s.dB + s.iB - s.dA - s.iA)} saved`,
  }));
  const withoutRecord = finalised.length - savings.length;

  // ── Clients ──
  const serviced = new Map();
  completed.forEach((b) => {
    const k = b.client_id || `unlinked:${b.id}`;
    (serviced.get(k) || serviced.set(k, []).get(k)).push(b);
  });
  const prior = new Set(priorClientIds);
  const linked = [...serviced.entries()].filter(([k]) => !k.startsWith('unlinked:'));
  const clientRow = ([k, bs]) => ({ key: k, date: bs[0].requested_date, title: bs[0].client_name || 'Client', subtitle: `${bs.length} visit${bs.length === 1 ? '' : 's'} in range`, value: shortDate(bs[0].requested_date) });
  const newList = linked.filter(([k]) => !prior.has(k));
  const returningList = linked.filter(([k]) => prior.has(k));
  const unlinked = serviced.size - linked.length;

  const overdue = [];
  const noHistory = [];
  regulars.filter((c) => !c.archived && !c.is_paused && !c.recurring_paused).forEach((c) => {
    const f = c.recurring_frequency || c.frequency;
    const interval = FREQ_DAYS[f] || (f === 'Custom' ? num(c.custom_frequency_days) : null) || 30;
    if (!c.last_visit_date) { noHistory.push(c); return; }
    const late = differenceInCalendarDays(parseISO(today), parseISO(c.last_visit_date)) - interval;
    if (late > 0) overdue.push({ c, late });
  });
  overdue.sort((a, b) => b.late - a.late);
  const overdueRows = overdue.map(({ c, late }) => ({
    key: c.id, title: c.client_name, subtitle: `Last cut ${shortDate(c.last_visit_date)} · ${c.recurring_frequency || c.frequency}`, value: `${late} day${late === 1 ? '' : 's'} overdue`,
  }));

  const val = (rows, extra = {}) => ({ rows, ...extra });
  return {
    monthly,
    money: {
      revenue: val(revenueRows, { value: priced.length ? revenue : null }),
      avgPrice: priced.length ? revenue / priced.length : null,
      revPerHour: val(dayRows, { value: revPerHour, basis: revOnFinalised.length }),
      unpricedRows, trend, bookingsCount: completed.length,
    },
    time: {
      finalisedCount: days.length, dayRows, notFinalisedRows,
      cut: cutMin, drive: driveMin, idle: idleMin, worked: workedMin,
      ratio: workedMin ? cutMin / workedMin : null,
      perDay: days.length ? { cut: cutMin / days.length, drive: driveMin / days.length, idle: idleMin / days.length } : null,
    },
    route: {
      avgLeg: legs.length ? round1(legs.reduce((s, l) => s + l.minutes, 0) / legs.length) : null,
      legRows: legRows([...legs].sort((a, b) => b.minutes - a.minutes)), worstRows: legRows(worstLegs),
      stopsPerDay: days.length ? round1(stopCount / days.length) : null,
      savedDrive: savings.length ? savings.reduce((s, x) => s + x.dB - x.dA, 0) : null,
      savedIdle: savings.length ? savings.reduce((s, x) => s + x.iB - x.iA, 0) : null,
      savingRows, savingsCount: savings.length, withoutRecord,
    },
    clients: {
      servicedCount: serviced.size, servicedRows: [...serviced.entries()].map(clientRow),
      newCount: newList.length, newRows: newList.map(clientRow),
      returningCount: returningList.length, returningRows: returningList.map(clientRow),
      unlinked, overdueCount: overdue.length, overdueRows, noHistoryCount: noHistory.length,
      regularsCount: regulars.filter((c) => !c.archived && !c.is_paused && !c.recurring_paused).length,
    },
  };
}