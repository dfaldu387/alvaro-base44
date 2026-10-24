import React from 'react';
import { cn } from '@/lib/utils';

// The one place that owns status colours.
// emerald = sent/delivered/success · amber = waiting/warning · red = failed/dead-letter
// violet = test data · zinc = neutral or suppressed
const TONES = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  test: 'bg-violet-50 text-violet-700 border-violet-200',
  neutral: 'bg-zinc-100 text-zinc-600 border-zinc-200',
};

const STATUS_TONE = {
  sent: 'success', delivered: 'success', read: 'success', success: 'success', confirmed: 'success', completed: 'success', acted: 'success',
  pending: 'warning', claimed: 'warning', queued: 'warning', waiting: 'warning', warning: 'warning',
  failed: 'danger', dead_letter: 'danger', 'dead-letter': 'danger', error: 'danger', declined: 'danger',
  test: 'test',
  suppressed: 'neutral', skipped: 'neutral', no_op: 'neutral', neutral: 'neutral',
};

export function toneFor(status) {
  return STATUS_TONE[String(status || '').toLowerCase()] || 'neutral';
}

export default function StatusBadge({ status, tone, children, className }) {
  const t = tone || toneFor(status);
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', TONES[t], className)}>
      {children ?? String(status || '').replace(/_/g, ' ')}
    </span>
  );
}