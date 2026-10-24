import React from 'react';
import { Clock, Navigation, Scissors } from 'lucide-react';

// What the customer sees for each stop state. In service reads "Arrived", as everywhere else.
const STATE_LABEL = {
  planned: 'Confirmed',
  preparing: 'Your barber is getting ready',
  on_the_way: 'On the way',
  arriving_soon: 'Arriving soon',
  arrived: 'Arrived',
  in_service: 'Arrived',
  completed: 'Completed',
  skipped: 'Rescheduling needed',
};

function awayText(n) {
  if (n === null || n === undefined) return null;
  if (n === 0) return "You're next";
  return `${n} stop${n === 1 ? '' : 's'} before yours`;
}

// The live tracking card. It shows only what getBookingTracking returns.
export default function TrackingCard({ view }) {
  const away = awayText(view.stops_away);
  const showWindow = view.arrival_window && !['arrived', 'in_service', 'completed', 'skipped'].includes(view.state);
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4 mb-6">
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-primary bg-primary/10">
        <Navigation className="w-4 h-4 shrink-0" />
        <span className="text-sm font-semibold">{STATE_LABEL[view.state] || 'Confirmed'}</span>
      </div>

      <p className="text-foreground">Hi {view.first_name || 'there'}, here&apos;s today&apos;s update on your Cut Deluxe appointment.</p>

      {showWindow && (
        <div className="text-center py-1">
          <p className="text-xs text-muted-foreground mb-0.5">Expected arrival</p>
          <p className="text-3xl font-heading font-bold text-primary">{view.arrival_window}</p>
        </div>
      )}

      <div className="space-y-1.5 text-sm pt-1 border-t border-border">
        {view.booked_time && (
          <div className="flex justify-between pt-2">
            <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Booked for</span>
            <span className="font-medium">{view.booked_time}</span>
          </div>
        )}
        {view.service && (
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-1"><Scissors className="w-3 h-3" /> Service</span>
            <span className="font-medium text-right">{view.service}</span>
          </div>
        )}
        {away && view.state !== 'completed' && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Barber</span>
            <span className="font-medium">{away}</span>
          </div>
        )}
      </div>
    </div>
  );
}