import React from 'react';
import { Scissors, Clock, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { STATE_LABEL } from '@/lib/placementPreview';

/**
 * The card that follows the pointer while a booking request is being dragged onto
 * the calendar, carrying the live placement state. Purely visual: it never takes a
 * pointer event, so the drop lands on the calendar underneath it.
 */
const TONES = {
  valid: { chip: 'bg-emerald-600 text-white', ring: 'ring-emerald-200', icon: CheckCircle2 },
  override: { chip: 'bg-amber-500 text-white', ring: 'ring-amber-200', icon: AlertTriangle },
  invalid: { chip: 'bg-red-600 text-white', ring: 'ring-red-200', icon: XCircle },
};

export default function PlacementGhost({ request, ghost, hover }) {
  if (!request || !ghost) return null;
  const tone = TONES[hover?.state] || null;
  const services = Array.isArray(request.services) ? request.services : [];
  return (
    <div className="fixed z-[60] pointer-events-none" style={{ left: ghost.x + 16, top: ghost.y + 16 }}>
      <div className={`w-[250px] rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl ${tone ? `ring-2 ${tone.ring}` : ''}`}>
        <p className="text-sm font-bold text-zinc-800 truncate">{request.client_name}</p>
        <div className="flex items-center gap-2.5 mt-1 text-[11px] text-zinc-500 flex-wrap">
          {services.length > 0 && (
            <span className="flex items-center gap-1 truncate max-w-[150px]"><Scissors className="w-3 h-3 shrink-0" />{services.join(' + ')}</span>
          )}
          {request.duration_mins && <span className="flex items-center gap-1 shrink-0"><Clock className="w-3 h-3" />{request.duration_mins} min</span>}
        </div>
        {tone && (
          <>
            <div className={`inline-flex items-center gap-1 mt-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.chip}`}>
              <tone.icon className="w-3 h-3" />{STATE_LABEL[hover.state]}
            </div>
            {hover.reason && <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">{hover.reason}</p>}
          </>
        )}
      </div>
    </div>
  );
}