import React, { useState } from 'react';
import { startOfWeek, addDays, isSameDay, addMonths, subMonths, isToday, format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  DAY_PERIODS, computeDayPeriodCounts,
  countToDemandLevel, dayDemandLevel, DAY_LATEST_START,
} from '@/lib/demandUtils';

const BOOKABLE_DAYS = { 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };

const DEMAND = {
  available:   { dot: 'bg-green-400',  label: 'Available',    color: 'text-green-400',         emoji: '🟢' },
  high_demand: { dot: 'bg-yellow-400', label: 'Popular',      color: 'text-yellow-400',        emoji: '🟡' },
  limited:     { dot: 'bg-red-400',    label: 'Limited',      color: 'text-red-400',           emoji: '🔴' },
  unavailable: { dot: 'bg-muted-foreground', label: 'Unavailable', color: 'text-muted-foreground', emoji: '⚫' },
};

function buildWeeks(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const start = startOfWeek(firstOfMonth, { weekStartsOn: 0 });
  const lastOfMonth = new Date(year, month + 1, 0);
  const weeks = [];
  let day = new Date(start);
  while (day <= lastOfMonth || weeks.length === 0) {
    const week = [];
    for (let d = 0; d < 7; d++) { week.push(new Date(day)); day = addDays(day, 1); }
    weeks.push(week);
    if (weeks.length >= 6) break;
  }
  return weeks;
}

export default function BookingCalendar({ allRequests, onSelectDay }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const maxDate = addDays(today, 28);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);

  const weeks = buildWeeks(viewYear, viewMonth);

  const todayMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const maxMonthStart = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
  const viewMonthStart = new Date(viewYear, viewMonth, 1);

  const canGoPrev = viewMonthStart > todayMonthStart;
  const canGoNext = viewMonthStart < maxMonthStart;

  function goPrev() {
    if (!canGoPrev) return;
    const m = subMonths(viewMonthStart, 1);
    setViewYear(m.getFullYear()); setViewMonth(m.getMonth()); setSelectedDate(null);
  }
  function goNext() {
    if (!canGoNext) return;
    const m = addMonths(viewMonthStart, 1);
    setViewYear(m.getFullYear()); setViewMonth(m.getMonth()); setSelectedDate(null);
  }

  function isBookable(date) {
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    return BOOKABLE_DAYS[d.getDay()] !== undefined && d >= today && d <= maxDate;
  }

  function getDemandLevel(date) {
    const dayName = BOOKABLE_DAYS[date.getDay()];
    const reqs = allRequests.filter(r => r.day === dayName);
    return dayDemandLevel(dayName, reqs);
  }

  function handleDateClick(date) {
    if (!isBookable(date)) return;
    setSelectedDate(prev => (prev && isSameDay(date, prev)) ? null : date);
  }

  const selectedWeekIndex = selectedDate
    ? weeks.findIndex(week => week.some(d => isSameDay(d, selectedDate)))
    : -1;

  // Expanded card data
  const dayName = selectedDate ? BOOKABLE_DAYS[selectedDate.getDay()] : null;
  const dayPeriods = dayName ? DAY_PERIODS[dayName] : [];
  const dayCounts = dayName
    ? computeDayPeriodCounts(dayName, allRequests.filter(r => r.day === dayName))
    : {};
  const overallDemand = dayName
    ? dayDemandLevel(dayName, allRequests.filter(r => r.day === dayName))
    : null;
  const demandInfo = overallDemand ? DEMAND[overallDemand] : null;
  const latestStart = dayName ? DAY_LATEST_START[dayName] : null;

  return (
    <div className="w-full">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-5 px-1">
        <button
          onClick={goPrev}
          disabled={!canGoPrev}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted disabled:opacity-20 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-semibold text-foreground">
          {format(new Date(viewYear, viewMonth, 1), 'MMMM yyyy')}
        </span>
        <button
          onClick={goNext}
          disabled={!canGoNext}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted disabled:opacity-20 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* Calendar rows with inline card expansion */}
      {weeks.map((week, wi) => (
        <React.Fragment key={wi}>
          <div className="grid grid-cols-7">
            {week.map((date, di) => {
              const bookable = isBookable(date);
              const inMonth = date.getMonth() === viewMonth;
              const selected = selectedDate && isSameDay(date, selectedDate);
              const isT = isToday(date);
              const lvl = bookable ? getDemandLevel(date) : null;

              return (
                <div key={di} className="flex flex-col items-center py-1">
                  <button
                    onClick={() => handleDateClick(date)}
                    disabled={!bookable}
                    className={[
                      'relative w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-all',
                      bookable ? 'cursor-pointer' : 'cursor-default',
                      !inMonth ? 'opacity-15' : !bookable ? 'opacity-30 text-muted-foreground' : 'text-foreground',
                      selected ? 'bg-primary text-primary-foreground shadow-md scale-105' : '',
                      !selected && bookable ? 'hover:bg-muted' : '',
                      isT && !selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {format(date, 'd')}
                  </button>
                  {/* Demand dot */}
                  <div className="h-1.5 mt-0.5 flex items-center">
                    {lvl && !selected && (
                      <div className={`w-1.5 h-1.5 rounded-full ${DEMAND[lvl].dot}`} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inline expanded card after the row containing selected date */}
          <AnimatePresence initial={false}>
            {selectedWeekIndex === wi && selectedDate && (
              <motion.div
                key="card"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="bg-card border border-border rounded-2xl p-5 mx-0.5 my-2">
                  {/* Header */}
                  <div className="mb-4">
                    <p className="text-lg font-heading font-bold text-foreground">
                      {format(selectedDate, 'EEEE d MMMM')}
                    </p>
                    {demandInfo && (
                      <span className={`inline-flex items-center gap-1.5 text-sm font-medium mt-1 ${demandInfo.color}`}>
                        {demandInfo.emoji} {demandInfo.label}
                      </span>
                    )}
                  </div>

                  {/* Period demand status */}
                  <div className="space-y-2 mb-4">
                    {dayPeriods.map(p => {
                      const lvl = countToDemandLevel(dayCounts[p.name] || 0);
                      const cfg = DEMAND[lvl];
                      return (
                        <div key={p.name} className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-3 py-2.5">
                          <span className="text-sm font-medium text-foreground">
                            {p.name} <span className="text-xs text-muted-foreground font-normal">({p.label})</span>
                          </span>
                          <span className={`text-xs font-semibold flex items-center gap-1 ${cfg.color}`}>
                            {cfg.emoji} {cfg.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {latestStart && (
                    <p className="text-xs text-muted-foreground mb-3">
                      Latest appointment start: <span className="font-medium text-foreground">{latestStart}</span>
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground/70 leading-relaxed mb-4">
                    These request levels are shown for reference only. You'll provide your availability on the next step.
                  </p>

                  <Button className="w-full" onClick={() => onSelectDay(dayName)}>
                    Continue
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </React.Fragment>
      ))}
    </div>
  );
}