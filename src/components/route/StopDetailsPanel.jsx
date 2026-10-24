import React, { useState } from 'react';
import {
  Phone, Mail, MapPin, StickyNote, Scissors, Users, Edit2, CalendarClock,
  CheckCircle2, Receipt, XCircle, AlertCircle, Loader2,
} from 'lucide-react';
import { decimalToLabel } from '@/lib/timeUtils';
import { money } from '@/lib/paymentApi';
import useStopDetails from '@/hooks/useStopDetails';
import StopQuickActions from '@/components/route/StopQuickActions';
import StopMessageDialog from '@/components/route/StopMessageDialog';
import CopyAddressButton from '@/components/route/CopyAddressButton';

/**
 * What an appointment shows once it is opened in the Route timeline.
 *
 * It reads the booking through the same rules the Calendar does and every action is a
 * short trip to the endpoint that already owns it — Edit Booking is the Calendar's own
 * editor, Reschedule is the Calendar's placement validator, cancel keeps the deposit
 * decision, and checkout is the existing Route checkout. Nothing here writes a time.
 */
export default function StopDetailsPanel({
  stop, exec, busy, hideExecution, error,
  onEdit, onReschedule, onComplete, onCheckout, onCancel, onNoShow,
}) {
  const [messageOpen, setMessageOpen] = useState(false);
  const { booking, payment, loaded, owing } = useStopDetails(stop.requestId, true);

  const state = exec?.state || 'planned';
  const finished = state === 'completed' || state === 'skipped' || ['completed', 'cancelled', 'no_show'].includes(stop.status);
  const participants = Array.isArray(booking?.participants) ? booking.participants : [];
  const services = (stop.services || []).filter(Boolean);
  const price = Number(booking?.price ?? stop.price ?? 0);
  const subtotal = Number(booking?.subtotal ?? 0);
  const discount = Number(booking?.group_discount ?? 0);
  const notes = booking?.notes || stop.notes || '';
  const phone = booking?.phone || stop.phone;
  const email = booking?.email || stop.email;

  const field = (icon, text) => (
    <p className="flex items-start gap-2 text-[12px] leading-snug text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );

  return (
    <div className="space-y-3">
      {/* Who, how to reach them, where */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[11px] font-semibold text-foreground">
            {decimalToLabel(stop.apptStart)}–{decimalToLabel(stop.apptEnd)} · {stop.duration} min
          </p>
          {phone && field(<Phone className="h-3 w-3" />, phone)}
          {email && field(<Mail className="h-3 w-3" />, email)}
          {stop.address && (
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words text-[12px] leading-snug text-muted-foreground">{stop.address}</span>
              <CopyAddressButton address={stop.address} className="-mt-0.5" />
            </div>
          )}
        </div>
        <StopQuickActions stop={stop} onMessage={() => setMessageOpen(true)} />
      </div>

      {/* Access notes — what the barber needs at the door */}
      {notes && (
        <div className="rounded-xl border border-border bg-background px-3 py-2">
          <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <StickyNote className="h-3 w-3" /> Notes
          </p>
          <p className="whitespace-pre-wrap text-[12px] leading-snug text-foreground">{notes}</p>
        </div>
      )}

      {/* Services, each person separately, and what it costs */}
      <div className="rounded-xl border border-border bg-background px-3 py-2">
        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Scissors className="h-3 w-3" /> Services
          {participants.length > 1 && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
              <Users className="h-2.5 w-2.5" /> {participants.length} people
            </span>
          )}
        </p>
        {participants.length > 0 ? (
          <div className="space-y-1.5">
            {participants.map((person, i) => (
              <div key={i}>
                {participants.length > 1 && (
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Person {i + 1}</p>
                )}
                <p className="text-[12px] text-foreground">{person.primary_service || 'No service'}</p>
                {(person.addons || []).length > 0 && (
                  <p className="text-[11px] text-muted-foreground">+ {person.addons.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        ) : services.length > 0 ? (
          <p className="text-[12px] text-foreground">{services.join(' + ')}</p>
        ) : (
          <p className="text-[12px] text-muted-foreground">No services</p>
        )}

        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {discount > 0 && (
            <>
              <Line label="Subtotal" value={money(subtotal)} />
              <Line label="Group discount" value={`−${money(discount)}`} />
            </>
          )}
          <Line label="Price" value={money(price)} strong />
          {payment && Number(payment.deposit_amount) > 0 && (
            <Line label="Deposit" value={money(payment.deposit_amount)} />
          )}
          {payment && Number(payment.amount_paid) > 0 && (
            <Line label="Paid" value={money(payment.amount_paid)} />
          )}
          {payment && (
            <Line
              label="Balance due"
              value={money(owing)}
              strong
              tone={owing > 0 ? 'text-amber-500' : 'text-green-500'}
            />
          )}
          {!loaded && <p className="text-[10px] italic text-muted-foreground">Reading payment details…</p>}
        </div>
      </div>

      {error && <p role="alert" className="text-[11px] font-medium text-red-500">{error}</p>}

      {/* Booking and the day's work */}
      <div className="grid grid-cols-2 gap-2">
        <ActionButton icon={<Edit2 className="h-3.5 w-3.5" />} label="Edit Booking" onClick={() => onEdit?.(stop)} disabled={finished} />
        <ActionButton icon={<CalendarClock className="h-3.5 w-3.5" />} label="Reschedule" onClick={() => onReschedule?.(stop)} disabled={finished} />
        {/* The current stop's execution buttons live in the execution bar above, so they are
            never offered twice on the same screen. */}
        {!hideExecution && (
          <>
            <ActionButton
              icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              label="Mark Completed"
              onClick={() => onComplete?.(stop)}
              disabled={finished || busy}
              tone="primary"
            />
            <ActionButton
              icon={<Receipt className="h-3.5 w-3.5" />}
              label="Checkout"
              onClick={() => onCheckout?.(stop)}
              disabled={busy}
            />
          </>
        )}
      </div>

      {/* Secondary: the two ways a booking ends badly */}
      {!finished && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onCancel?.(stop)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-500/30 py-2 text-[11px] font-semibold text-red-500 hover:bg-red-500/10"
          >
            <XCircle className="h-3.5 w-3.5" /> Cancel appointment
          </button>
          <button
            type="button"
            onClick={() => onNoShow?.(stop)}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-orange-500/30 py-2 text-[11px] font-semibold text-orange-400 hover:bg-orange-500/10 disabled:opacity-50"
          >
            <AlertCircle className="h-3.5 w-3.5" /> No-show
          </button>
        </div>
      )}

      <StopMessageDialog requestId={stop.requestId} open={messageOpen} onClose={() => setMessageOpen(false)} />
    </div>
  );
}

function Line({ label, value, strong, tone }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-[11px] ${strong ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-[12px] tabular-nums ${strong ? 'font-bold' : ''} ${tone || 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, tone }) {
  const cls = tone === 'primary'
    ? 'border-primary/40 bg-primary/10 text-primary'
    : 'border-border bg-background text-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[11px] font-bold active:scale-[0.98] disabled:opacity-40 ${cls}`}
    >
      {icon} {label}
    </button>
  );
}