import React from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { decimalToLabel } from '@/lib/timeUtils';
import useCopyAddress from './useCopyAddress';

/** "4.8 km · 12 min drive" — the leg that brings the barber to this stop. */
function driveLabel(drive) {
  if (!drive || drive.state !== 'ok' || !drive.mins) return '';
  const km = drive.km != null ? `${Number(drive.km).toFixed(1)} km · ` : '';
  return `${km}${drive.mins} min drive`;
}

/** One client on the day's execution list: who, when, where, and the one button that matters. */
export default function ExecutionRow({ stop, index, drive, completed, onCheckout }) {
  const { copied, copy } = useCopyAddress();
  const services = (stop.services || []).filter(Boolean).join(', ') || 'Service';
  const driveText = driveLabel(drive);

  return (
    <div className="flex gap-3 border-b border-border/70 px-4 py-3.5 last:border-b-0">
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${completed ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-foreground'}`}>
        {completed ? <Check className="h-4 w-4" /> : index}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-bold tabular-nums text-foreground">{decimalToLabel(stop.apptStart)}</p>
          <button
            type="button"
            onClick={() => copy(stop.address)}
            aria-label="Copy address"
            className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        <p className={`truncate text-sm font-semibold ${completed ? 'text-muted-foreground' : 'text-foreground'}`}>{stop.clientName}</p>
        <p className="truncate text-[12px] text-muted-foreground">{services}</p>
        {stop.address && <p className="mt-0.5 break-words text-[12px] text-muted-foreground">{stop.address}</p>}
        {driveText && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{driveText}</p>}
        {copied && <p className="mt-1 text-[11px] font-medium text-emerald-600">Address copied</p>}

        {completed ? (
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Completed</p>
        ) : (
          <button
            type="button"
            onClick={() => onCheckout(stop)}
            className="mt-2.5 inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-80"
          >
            Checkout <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}