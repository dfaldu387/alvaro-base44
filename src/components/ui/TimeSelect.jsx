/**
 * TimeSelect — a simple dropdown for picking a time in human-readable format.
 * Props:
 *   value: decimal hour (e.g. 14.5)
 *   onChange: (decimalHour) => void
 *   startHour?: number (default 6)
 *   endHour?: number (default 22)
 *   className?: string
 *   disabled?: boolean
 */
import React from 'react';
import { buildTimeOptions } from '@/lib/timeUtils';

export default function TimeSelect({ value, onChange, startHour = 6, endHour = 22, className = '', disabled = false }) {
  const options = buildTimeOptions(startHour, endHour);

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(parseFloat(e.target.value))}
      disabled={disabled}
      className={`bg-secondary text-foreground border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50 ${className}`}
    >
      <option value="" disabled>Select time</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}