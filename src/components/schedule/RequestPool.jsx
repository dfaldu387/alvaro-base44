import React from 'react';
import { Scissors, Clock, MapPin, Calendar, Plus, CheckCheck } from 'lucide-react';

const STATUS_CONFIG = {
  pending:   { label: 'New Request',          dot: 'bg-blue-400',   text: 'text-blue-700' },
  confirmed: { label: 'Confirmed',            dot: 'bg-green-400',  text: 'text-emerald-700' },
  waitlist:  { label: 'Waiting Confirmation', dot: 'bg-yellow-400', text: 'text-amber-700' },
  declined:  { label: 'Cancelled',            dot: 'bg-red-400',    text: 'text-red-700' },
  planned:   { label: 'Planned',              dot: 'bg-purple-400', text: 'text-violet-700' },
};

export default function RequestPool({ requests, plannedIds, onAdd }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">All Requests</h2>
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No requests for this day</p>
      ) : (
        <div className="space-y-3">
          {requests.map(req => {
            const isPlanned = plannedIds.includes(req.id);
            const statusKey = req.status || 'pending';
            const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.pending;
            const services = Array.isArray(req.services) ? req.services : [];
            const serviceLabel = services.length > 0 ? services.join(' + ') : '—';

            return (
              <div
                key={req.id}
                className={`bg-card border rounded-2xl p-4 transition-all ${
                  isPlanned ? 'border-primary/40 bg-primary/5' : 'border-border'
                }`}
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-foreground shrink-0">
                      {(req.client_name || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground leading-tight">{req.client_name}</p>
                      {req.address && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <MapPin className="w-3 h-3" />{req.address}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-secondary ${statusCfg.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                      {statusCfg.label}
                    </span>
                    {isPlanned ? (
                      <div className="flex items-center gap-1 bg-primary/20 text-primary text-xs font-semibold px-3 py-1.5 rounded-xl border border-primary/30">
                        <CheckCheck className="w-3 h-3" /> Added
                      </div>
                    ) : (
                      <button
                        onClick={() => onAdd(req)}
                        className="flex items-center gap-1 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-primary/80 transition-all"
                      >
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    )}
                  </div>
                </div>

                {/* Details row */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><Scissors className="w-3 h-3" /> Service</p>
                    <p className="text-foreground font-medium">{serviceLabel}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><Clock className="w-3 h-3" /> Duration</p>
                    <p className="text-foreground font-medium">{req.duration_mins || 30} min</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-0.5 flex items-center gap-1"><Calendar className="w-3 h-3" /> Availability</p>
                    <p className="text-foreground font-medium">{req.availability_window || 'Flexible'}</p>
                  </div>
                </div>

                {req.notes && (
                  <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border italic">{req.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-4 text-center">
        Showing {requests.length} of {requests.length} requests
      </p>
    </div>
  );
}