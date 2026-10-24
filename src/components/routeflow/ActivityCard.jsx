import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Lock, Repeat, User, XCircle } from 'lucide-react';
import ActivityDetailPanel from '@/components/routeflow/ActivityDetailPanel';
import { formatMinutes, formatStamp, iconKeyFor, outcomeLabel, relativeDayLabel } from '@/lib/routeFlowActivity';
import { cn } from '@/lib/utils';

const ICONS = {
  success: CheckCircle2,
  reshuffle: Repeat,
  unscheduled: XCircle,
  warning: AlertTriangle,
  lock: Lock,
  user: User,
};

const ICON_STYLE = {
  success: 'bg-emerald-50 text-emerald-600',
  reshuffle: 'bg-[#6366F1]/10 text-[#6366F1]',
  unscheduled: 'bg-rose-50 text-rose-600',
  warning: 'bg-amber-50 text-amber-600',
  lock: 'bg-rose-50 text-rose-600',
  user: 'bg-sky-50 text-sky-600',
};

/** One operational log entry: what happened, what changed, and why. */
export default function ActivityCard({ item, expanded, onToggle }) {
  const iconKey = iconKeyFor(item);
  const Icon = ICONS[iconKey] || Repeat;

  const facts = [];
  if (item.counts.moved) facts.push(`${item.counts.moved} appointment${item.counts.moved === 1 ? '' : 's'} moved`);
  if (item.counts.placed) facts.push(`${item.counts.placed} request${item.counts.placed === 1 ? '' : 's'} placed`);
  if (item.counts.unscheduled) facts.push(`Left Unscheduled`);
  if (item.counts.evaluated !== null) facts.push(`${item.counts.evaluated} evaluated`);

  const drive = formatMinutes(item.metrics.driveBefore, item.metrics.driveAfter);
  const idle = formatMinutes(item.metrics.idleBefore, item.metrics.idleAfter);
  const day = relativeDayLabel(item.scheduleDate);
  const stamp = formatStamp(item.timestamp);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', ICON_STYLE[iconKey])}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-bold text-zinc-900 leading-snug">{item.title}</p>
            <span className="text-[11px] text-zinc-400 shrink-0 whitespace-nowrap">
              {day ? `${day}${stamp ? ` · ${stamp}` : ''}` : stamp}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Chip className={item.actorType === 'admin' ? 'bg-sky-50 text-sky-700' : 'bg-[#6366F1]/10 text-[#6366F1]'}>
              {item.actorType === 'admin' ? `Admin · ${item.actor}` : 'Route Flow'}
            </Chip>
            {item.outcome && (item.outcome === 'skipped' || item.outcome === 'aborted' || item.outcome === 'pending_review') && (
              <Chip className="bg-amber-50 text-amber-700">{outcomeLabel(item.outcome)}</Chip>
            )}
            {item.counts.protectedMoved > 0 && (
              <Chip className="bg-rose-50 text-rose-700">
                {item.counts.protectedMoved} protected appointment{item.counts.protectedMoved === 1 ? '' : 's'} moved
              </Chip>
            )}
          </div>

          {facts.length > 0 && (
            <p className="text-xs text-zinc-600 mt-2">{facts.join(' · ')}</p>
          )}

          {(drive || idle) && (
            <p className="text-xs text-zinc-500 mt-1">
              {drive && <>Drive: <span className="font-semibold text-zinc-700">{drive}</span></>}
              {drive && idle && <span className="text-zinc-300"> · </span>}
              {idle && <>Idle: <span className="font-semibold text-zinc-700">{idle}</span></>}
            </p>
          )}

          <p className="text-[11px] text-zinc-400 mt-1">
            {item.counts.protectedMoved > 0 ? 'Needs review — a protected appointment moved.' : 'Protected appointments moved: 0'}
          </p>

          {item.summary && (
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{item.summary}</p>
          )}

          {item.reason?.text && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800 leading-relaxed">{item.reason.text}</p>
            </div>
          )}

          <button
            onClick={onToggle}
            className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#6366F1] hover:text-[#4f46e5]"
          >
            {expanded ? 'Hide details' : 'View details'}
            <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
          </button>

          {expanded && <ActivityDetailPanel item={item} />}
        </div>
      </div>
    </div>
  );
}

function Chip({ children, className }) {
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', className)}>{children}</span>
  );
}