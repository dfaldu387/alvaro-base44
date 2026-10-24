export const COLUMNS = [
  { key: 'due', title: 'Due', hint: 'Eligible for a reminder, not messaged this cycle' },
  { key: 'messaged', title: 'Messaged', hint: 'Reminder queued, sent or delivered. Failed and suppressed stay here, flagged' },
  { key: 'replied', title: 'Replied', hint: 'Replied after the reminder' },
  { key: 'booked', title: 'Booked', hint: 'Booked after the reminder' },
  { key: 'follow_up', title: 'Follow-up needed', hint: 'Reminder went out, no reply or booking yet' },
];

export const STATE_STYLE = {
  due: 'bg-indigo-100 text-indigo-700',
  queued: 'bg-amber-100 text-amber-800',
  sent: 'bg-sky-100 text-sky-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-700',
  dead_letter: 'bg-red-100 text-red-700',
  enqueue_failed: 'bg-red-100 text-red-700',
  suppressed: 'bg-zinc-200 text-zinc-700',
  unknown: 'bg-zinc-100 text-zinc-500',
};

export const ACTION_LABEL = {
  send_now: 'Send now',
  skip_cycle: 'Skip this cycle',
  pause: 'Pause reminders',
  mark_booked: 'Mark as booked',
};

export const ACTION_CONFIRM = {
  send_now: (n) => `Queue a message to ${n} now? It still obeys opt-out, test-data and quiet-hours rules.`,
  skip_cycle: (n) => `Skip ${n} for this cycle? No message will be sent to them this week.`,
  pause: (n) => `Pause reminders for ${n}? They will stop appearing until reminders are resumed on their client record.`,
  mark_booked: (n) => `Mark ${n} as booked? Reminders stop for this booking.`,
};

export const fmtDate = (v) => {
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};