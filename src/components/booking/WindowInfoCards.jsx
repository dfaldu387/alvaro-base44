import React from 'react';
import { Info, Lightbulb } from 'lucide-react';

export default function WindowInfoCards({ services, serviceQtys }) {
  const selectedLines = services
    .filter(s => (serviceQtys[s.id] || 0) > 0)
    .map(s => `${s.name} × ${serviceQtys[s.id]}`);

  return (
    <div className="space-y-3">
      {/* Selected Services Summary */}
      {selectedLines.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1.5">Selected Services</p>
          <div className="space-y-0.5">
            {selectedLines.map(line => (
              <p key={line} className="text-sm font-medium text-foreground">{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* Availability guidance */}
      <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Larger availability windows improve your chances of confirmation.
        </p>
      </div>

      {/* Confirmation info card */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-3">
        <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-foreground mb-0.5">Request Confirmation</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Requests are reviewed and confirmed at 7:00pm the night before your appointment.
          </p>
        </div>
      </div>

      {/* Availability reminder */}
      <p className="text-xs text-muted-foreground/70 text-center px-2">
        Please ensure you're available for the entire selected window.
      </p>
    </div>
  );
}