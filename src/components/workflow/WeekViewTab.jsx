import React, { useState, useRef, useEffect, useMemo } from 'react';
import { addDays, format, isSameDay, parseISO } from 'date-fns';
import { Bell, MessageSquare, CalendarClock, ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { weekStart, followUpDueDate } from '@/lib/reminderUtils';

const WEEK_STAGES = [
  { key: 'needs_reminder', label: 'Needs Reminder', desc: 'Clients who are due or overdue for a reminder.', icon: Bell,
    header: 'text-orange-700', sectionBg: 'bg-orange-50/40', cardBg: 'bg-orange-50/70', cardBorder: 'border-orange-200', chip: 'bg-orange-100 text-orange-700' },
  { key: 'waiting_on_response', label: 'Waiting on Client', desc: 'Clients who have not replied or need to confirm a time.', icon: MessageSquare,
    header: 'text-blue-700', sectionBg: 'bg-blue-50/40', cardBg: 'bg-blue-50/70', cardBorder: 'border-blue-200', chip: 'bg-blue-100 text-blue-700' },
  { key: 'time_received', label: 'Ready to Schedule', desc: 'Clients who have replied and are ready to book.', icon: CalendarClock,
    header: 'text-amber-700', sectionBg: 'bg-amber-50/40', cardBg: 'bg-amber-50/70', cardBorder: 'border-amber-200', chip: 'bg-amber-100 text-amber-700' },
];

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEK_MODES = ['this_week', 'next_week', 'week_after'];

export function WeekNav({ weekMode, setWeekMode }) {
  const offset = Math.max(0, WEEK_MODES.indexOf(weekMode));
  const monday = weekStart(offset);
  const sunday = addDays(monday, -1);
  const days = Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
  const range = days[0].getMonth() === days[6].getMonth()
    ? `${format(days[0], 'd')} – ${format(days[6], 'd MMM yyyy')}`
    : `${format(days[0], 'd MMM')} – ${format(days[6], 'd MMM yyyy')}`;
  const go = (dir) => setWeekMode(WEEK_MODES[Math.max(0, Math.min(2, offset + dir))]);

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" className="bg-white border-zinc-200 text-zinc-700 h-9" onClick={() => setWeekMode('this_week')}>Today</Button>
      <button onClick={() => go(-1)} className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600 text-lg">‹</button>
      <button onClick={() => go(1)} className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600 text-lg">›</button>
      <span className="text-sm font-medium text-zinc-800 min-w-[130px] text-center">{range}</span>
    </div>
  );
}

export default function WeekViewTab({ columns, weekMode, setWeekMode, onCardClick }) {
  const [expanded, setExpanded] = useState({ needs_reminder: true, waiting_on_response: true, time_received: true });

  const offset = Math.max(0, WEEK_MODES.indexOf(weekMode));
  const monday = weekStart(offset);
  const sunday = addDays(monday, -1);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(sunday, i)), [weekMode]);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const dayIndexForClient = (client, stage) => {
    if (stage === 'time_received') {
      const dayName = client.received_day || client.preferred_day;
      if (dayName && dayName !== 'Flexible') {
        const idx = days.findIndex(d => format(d, 'EEEE') === dayName);
        if (idx >= 0) return idx;
      }
      return 0;
    }
    const dateStr = stage === 'needs_reminder' ? client.next_reminder_date : followUpDueDate(client.reminder_sent_date);
    if (!dateStr) return 0;
    const d = parseISO(dateStr);
    if (isNaN(d)) return 0;
    const idx = days.findIndex(day => isSameDay(day, d));
    if (idx >= 0) return idx;
    return d < days[0] ? 0 : 6;
  };

  const isOverdue = (client, stage) => {
    if (stage === 'needs_reminder') return client.next_reminder_date && client.next_reminder_date < todayStr;
    if (stage === 'waiting_on_response') {
      const due = followUpDueDate(client.reminder_sent_date);
      return due && due < todayStr;
    }
    return false;
  };

  return (
    <div className="space-y-3">
      {WEEK_STAGES.map(stageDef => {
        const items = columns[stageDef.key] || [];
        const isExpanded = expanded[stageDef.key];
        const dayBuckets = Array.from({ length: 7 }, () => []);
        items.forEach(c => { dayBuckets[dayIndexForClient(c, stageDef.key)].push(c); });

        return (
          <div key={stageDef.key} className={cn('rounded-xl border border-zinc-200 overflow-hidden', stageDef.sectionBg)}>
            <button
              onClick={() => setExpanded(prev => ({ ...prev, [stageDef.key]: !prev[stageDef.key] }))}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white/80 hover:bg-white transition-colors"
            >
              <stageDef.icon className={cn('w-5 h-5', stageDef.header)} />
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm text-zinc-900">{stageDef.label}</h3>
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', stageDef.chip)}>{items.length}</span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5">{stageDef.desc}</p>
              </div>
              <ChevronDown className={cn('w-4 h-4 text-zinc-400 transition-transform', isExpanded && 'rotate-180')} />
            </button>

            {isExpanded && (
              <>
                <div className="grid grid-cols-7 border-y border-zinc-200 bg-white/60">
                  {days.map((d, i) => {
                    const isToday = isSameDay(d, today);
                    return (
                      <div key={i} className="px-1 py-1.5 text-center border-r border-zinc-100 last:border-r-0">
                        <p className={cn('text-[10px] font-semibold tracking-wider', isToday ? 'text-violet-600' : 'text-zinc-400')}>{DAY_LABELS[i]}</p>
                        <p className={cn('text-xs font-bold', isToday ? 'text-violet-700' : 'text-zinc-700')}>{format(d, 'd MMM')}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-7">
                  {dayBuckets.map((bucket, i) => (
                    <DayColumn key={i} clients={bucket} stage={stageDef.key} stageDef={stageDef} isOverdue={isOverdue} onCardClick={onCardClick} />
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DayColumn({ clients, stage, stageDef, isOverdue, onCardClick }) {
  const scrollRef = useRef(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  };

  useEffect(() => { checkScroll(); }, [clients.length]);

  return (
    <div className="relative border-r border-zinc-100 last:border-r-0 min-h-[80px]">
      <div ref={scrollRef} onScroll={checkScroll} className="overflow-y-auto wf-scroll p-1.5 space-y-2" style={{ maxHeight: '320px' }}>
        {clients.length === 0 ? (
          <p className="text-[11px] text-zinc-300 text-center py-4">—</p>
        ) : (
          clients.map(c => {
            const overdue = isOverdue(c, stage);
            let statusLabel = null, statusClass = '', statusIcon = null;
            if (stage === 'needs_reminder' && overdue) {
              statusLabel = 'Overdue'; statusClass = 'text-red-600 bg-red-50'; statusIcon = <AlertCircle className="w-2.5 h-2.5" />;
            } else if (stage === 'waiting_on_response') {
              statusLabel = 'Awaiting reply'; statusClass = 'text-blue-600 bg-blue-50';
            } else if (stage === 'time_received') {
              statusLabel = 'Ready to book'; statusClass = 'text-amber-700 bg-amber-50';
            }
            return (
              <button
                key={c.id}
                onClick={() => onCardClick(c)}
                className={cn('w-full text-left rounded-lg border p-2.5 transition-shadow hover:shadow-sm', stageDef.cardBg, stageDef.cardBorder)}
              >
                <p className="text-xs font-semibold text-zinc-900 truncate">{c.client_name}</p>
                <p className="text-[11px] text-zinc-500 truncate">{c.usual_service || '—'}</p>
                <p className="text-[11px] text-zinc-400 truncate">{c.frequency || '—'} • {c.suburb || '—'}</p>
                {statusLabel && (
                  <span className={cn('inline-flex items-center gap-0.5 mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded', statusClass)}>
                    {statusIcon} {statusLabel}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      {canScrollDown && (
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white/90 to-transparent pointer-events-none" />
      )}
    </div>
  );
}