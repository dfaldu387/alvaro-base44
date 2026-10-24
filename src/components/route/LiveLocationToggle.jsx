import React from 'react';
import { MapPin } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

/** "Share my location for today": off by default, the barber's own switch. */
export default function LiveLocationToggle({ sharing, busy, note, lookups, inTransit, onToggle }) {
  const line = sharing
    ? (inTransit ? 'Sharing now with Cut Deluxe. Clients only see a better arrival time, never where you are.' : 'On. Your position is read only while you are on the way to a client.')
    : 'Off. Arrival times follow your taps. If on, your position goes to Cut Deluxe only while you are on the way.';
  return (
    <div className="mx-4 mb-3 bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-3 min-h-[56px]">
      <MapPin className={`w-4 h-4 shrink-0 ${sharing ? 'text-primary' : 'text-muted-foreground'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground leading-tight">Share my location for today</p>
        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 break-words">{note || line}</p>
        {sharing && lookups > 0 && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{lookups} travel-time lookups today</p>}
      </div>
      <Switch checked={sharing} disabled={busy} onCheckedChange={onToggle} aria-label="Share my location for today" className="shrink-0" />
    </div>
  );
}