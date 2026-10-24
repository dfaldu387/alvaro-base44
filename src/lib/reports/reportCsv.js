import { fmtMins } from '@/lib/reports/reportCalc';

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (...cells) => cells.map(esc).join(',');

// One CSV for the selected range: headline figures, the trend, then the records behind them.
export function buildReportCsv(report, from, to) {
  const { money, time, route, clients } = report;
  const out = [line('Cut Deluxe business report'), line('From', from, 'To', to), ''];
  out.push(line('Headline figures'), line('Figure', 'Value', 'Note'));
  out.push(line('Revenue (completed bookings)', money.revenue.value?.toFixed(2) ?? '', 'Payment received where recorded, otherwise booking price'));
  out.push(line('Average price per booking', money.avgPrice?.toFixed(2) ?? ''));
  out.push(line('Revenue per working hour', money.revPerHour.value?.toFixed(2) ?? '', 'Finalised days only'));
  out.push(line('Cutting minutes', Math.round(time.cut), 'Finalised days only'));
  out.push(line('Drive minutes', Math.round(time.drive), 'Finalised days only'));
  out.push(line('Idle minutes', Math.round(time.idle), 'Finalised days only'));
  out.push(line('Earning-time ratio %', time.ratio == null ? '' : Math.round(time.ratio * 100)));
  out.push(line('Finalised days', time.finalisedCount));
  out.push(line('Days not finalised (excluded)', time.notFinalisedRows.length));
  out.push(line('Average drive between stops (min)', route.avgLeg ?? ''));
  out.push(line('Average stops per day', route.stopsPerDay ?? ''));
  out.push(line('Drive minutes saved by optimiser', route.savedDrive ?? ''));
  out.push(line('Idle minutes saved by optimiser', route.savedIdle ?? ''));
  out.push(line('Clients serviced', clients.servicedCount));
  out.push(line('New clients', clients.newCount));
  out.push(line('Returning clients', clients.returningCount));
  out.push(line('Regulars overdue now', clients.overdueCount), '');

  out.push(line('Trend'), line('Period', 'Completed bookings', 'Revenue', 'Average price', 'Revenue per working hour'));
  money.trend.forEach((t) => out.push(line(t.label, t.count, t.revenue.toFixed(2), t.avg?.toFixed(2) ?? '', t.perHour?.toFixed(2) ?? '')));
  out.push('', line('Revenue records'), line('Date', 'Client', 'Detail', 'Amount'));
  money.revenue.rows.forEach((r) => out.push(line(r.date, r.title, r.subtitle, r.value)));
  out.push('', line('Finalised days'), line('Day', 'Detail', 'Earning'));
  time.dayRows.forEach((r) => out.push(line(r.title, r.subtitle, r.value)));
  out.push('', line('Days not finalised (excluded from time figures)'), line('Day', 'Reason', 'Bookings'));
  time.notFinalisedRows.forEach((r) => out.push(line(r.title, r.subtitle, r.value)));
  out.push('', line('Drive legs, longest first'), line('Leg', 'Day', 'Minutes'));
  route.legRows.forEach((r) => out.push(line(r.title, r.subtitle, r.value)));
  out.push('', line('Regulars overdue'), line('Client', 'Detail', 'Overdue'));
  clients.overdueRows.forEach((r) => out.push(line(r.title, r.subtitle, r.value)));
  return out.join('\n');
}

export function downloadCsv(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export { fmtMins };