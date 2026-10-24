/**
 * AppointmentDetailPanel — Square-style side panel (slides in from the right).
 * Stays alongside the calendar rather than replacing it.
 *
 * The panel reads the booking. One global "Edit Booking" switches it into the
 * editor (components/schedule/edit/BookingEditForm), which writes through the same
 * backend endpoints the rest of the app uses — never a second set of rules.
 */
import React, { useState } from 'react';
import { X, Phone, MessageSquare, MapPin, Mail, Clock, Scissors, User, Edit2, Calendar, CheckCircle2, XCircle, AlertCircle, RotateCcw, Lock, Unlock, Star, Info } from 'lucide-react';
import FavouriteStar from '@/components/FavouriteStar';
import { decimalToLabel } from '@/lib/timeUtils';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import ReplyStatusBadge from '@/components/schedule/ReplyStatusBadge';
import ClientNotificationLine from '@/components/schedule/ClientNotificationLine';
import BookingMessages from '@/components/schedule/BookingMessages';
import CancelDepositChoice from '@/components/payments/CancelDepositChoice';
import BookingEditForm from '@/components/schedule/edit/BookingEditForm';

export const STATUS_CONFIG = {
  draft:            { label: 'Draft',       color: 'text-purple-700', bg: 'bg-purple-100', border: 'border-purple-200', dot: 'bg-purple-500' },
  scheduled:        { label: 'Scheduled',   color: 'text-blue-700',   bg: 'bg-blue-100',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  completed:        { label: 'Completed',   color: 'text-green-700',  bg: 'bg-green-100',  border: 'border-green-200',  dot: 'bg-green-500' },
  cancelled:        { label: 'Cancelled',   color: 'text-zinc-500',   bg: 'bg-zinc-100',   border: 'border-zinc-200',   dot: 'bg-zinc-400' },
  no_show:          { label: 'No-show',     color: 'text-red-700',    bg: 'bg-red-100',    border: 'border-red-200',    dot: 'bg-red-500' },
  rescheduled:      { label: 'Rescheduled', color: 'text-orange-700', bg: 'bg-orange-100', border: 'border-orange-200', dot: 'bg-orange-500' },
  blocked:          { label: 'Blocked',     color: 'text-zinc-500',   bg: 'bg-zinc-100',   border: 'border-zinc-200',   dot: 'bg-zinc-400' },
  // legacy
  planned:          { label: 'Scheduled',   color: 'text-blue-700',   bg: 'bg-blue-100',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  window_confirmed: { label: 'Scheduled',   color: 'text-blue-700',   bg: 'bg-blue-100',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  waiting:          { label: 'Scheduled',   color: 'text-blue-700',   bg: 'bg-blue-100',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  client_confirmed: { label: 'Scheduled',   color: 'text-blue-700',   bg: 'bg-blue-100',   border: 'border-blue-200',   dot: 'bg-blue-500' },
};

export default function AppointmentDetailPanel({
  appt, onClose, onComplete, onCancel, onNoShow, onRemove, onAddToast,
  onSetScheduleStatus, onConfirmOverride, onToggleFavourite, onBookingSaved,
}) {
  const [editing, setEditing] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [deposit, setDeposit] = useState({ ready: false, decision: null, opSeq: 0 });

  if (!appt) return null;

  const statusCfg = STATUS_CONFIG[appt.status] || STATUS_CONFIG.scheduled;
  const isActive = ['draft', 'scheduled', 'planned', 'window_confirmed', 'waiting', 'client_confirmed'].includes(appt.status);
  const isBlock = appt.isBlock || appt.status === 'blocked';
  // Completed, cancelled and blocked records are history: they are read, never edited here.
  const canEdit = !isBlock && isActive && !!appt.requestId;
  const participants = Array.isArray(appt.participants) ? appt.participants : [];

  // The editor saved: back to the reading view, and the calendar re-reads the booking.
  const handleSaved = () => {
    setEditing(false);
    onBookingSaved?.();
  };

  return (
    <>
      {/* Backdrop (mobile only) */}
      <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white border-l border-zinc-200 flex flex-col shadow-xl animate-in slide-in-from-right duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-zinc-100 flex items-center justify-center text-sm font-bold text-zinc-700 shrink-0">
              {isBlock ? '🚫' : (appt.clientName || '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-zinc-900 truncate">{isBlock ? (appt.clientName?.replace('🚫 ', '') || 'Blocked') : appt.clientName}</p>
                {!isBlock && (
                  <FavouriteStar
                    isFavourite={appt.is_favourite}
                    onToggle={() => onToggleFavourite?.(appt)}
                    name={appt.clientName}
                  />
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', statusCfg.color, statusCfg.bg, statusCfg.border)}>{statusCfg.label}</span>
                {!isBlock && appt.is_new_client && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-900 bg-[#6366f1] px-1.5 py-0.5 rounded-full">NEW</span>
                )}
                {editing && (
                  <span className="text-[10px] font-semibold text-[#6d28d9]">Editing</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isBlock && appt.phone && (
              <a href={`tel:${appt.phone}`} className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200">
                <Phone className="w-3.5 h-3.5 text-zinc-500" />
              </a>
            )}
            {!isBlock && appt.phone && (
              <a href={`sms:${appt.phone}`} className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200">
                <MessageSquare className="w-3.5 h-3.5 text-zinc-500" />
              </a>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200">
              <X className="w-3.5 h-3.5 text-zinc-500" />
            </button>
          </div>
        </div>

        {/* ── Editing the whole booking ─────────────────────────────────────── */}
        {editing ? (
          <BookingEditForm
            appt={appt}
            onCancel={() => setEditing(false)}
            onSaved={handleSaved}
            onAddToast={onAddToast}
          />
        ) : (
          <>
            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* The one edit entry point for the whole booking */}
              {canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#7c3aed]/30 bg-[#f8f6ff] py-2.5 text-xs font-bold text-[#6d28d9] transition-colors hover:bg-[#f3efff]"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit Booking
                </button>
              )}

              {/* Time & Day */}
              <div className={cn(
                'rounded-xl p-3 flex items-center gap-3 border',
                appt.status === 'cancelled' ? 'bg-zinc-50/60 border-zinc-200/60' : 'bg-zinc-50 border-zinc-200'
              )}>
                <Calendar className={cn('w-4 h-4 shrink-0', appt.status === 'cancelled' ? 'text-zinc-500' : 'text-[#7c3aed]')} />
                <div>
                  <p className={cn('text-sm font-bold', appt.status === 'cancelled' ? 'text-zinc-500 line-through' : 'text-zinc-900')}>{appt.day} · {decimalToLabel(appt.apptStart)}–{decimalToLabel(appt.apptEnd)}</p>
                  <p className="text-xs text-zinc-500">{appt.duration} min</p>
                </div>
              </div>

              {/* Availability override info */}
              {!isBlock && appt.availability_override && appt.windowStart != null && appt.windowEnd != null && (
                <div className={cn(
                  'rounded-xl p-3 border',
                  appt.override_status === 'confirmed' ? 'bg-amber-50 border-amber-200' : 'bg-amber-50 border-amber-300'
                )}>
                  <div className="flex items-start gap-2">
                    <AlertCircle className={cn('w-4 h-4 shrink-0 mt-0.5', appt.override_status === 'confirmed' ? 'text-amber-500' : 'text-amber-600')} />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className="text-xs font-bold text-amber-900">
                        {appt.override_status === 'confirmed' ? 'Outside submitted availability (confirmed)' : 'Outside submitted availability'}
                      </p>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                          <span className="text-[11px] text-amber-800">Customer availability: {decimalToLabel(appt.windowStart)}–{decimalToLabel(appt.windowEnd)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-amber-600 shrink-0" />
                          <span className="text-[11px] text-amber-800">Scheduled time: {decimalToLabel(appt.apptStart)}</span>
                        </div>
                      </div>
                      {appt.override_status === 'awaiting_confirmation' && (
                        <p className="text-[10px] text-amber-700 font-medium pt-1">Awaiting client confirmation — contact the client to confirm the new time.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Where the appointment sits, and whether the client knows — two facts,
                  shown separately so neither is assumed from the other. */}
              {!isBlock && <ClientNotificationLine bookingId={appt.requestId} scheduleStatus={appt.schedule_status} />}

              {!isBlock && isActive && <ReplyStatusBadge appt={appt} />}

              {/* Schedule status (provisional / locked / confirmed) */}
              {!isBlock && isActive && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-500">Schedule</span>
                    <span className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                      appt.schedule_status === 'confirmed'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : appt.schedule_status === 'locked'
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-amber-50 border-amber-200 text-amber-700'
                    )}>
                      {appt.schedule_status === 'confirmed' ? 'Confirmed' : appt.schedule_status === 'locked' ? 'Locked' : 'Provisional'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {appt.schedule_status === 'locked' ? (
                      <button onClick={() => onSetScheduleStatus?.(appt.id, 'provisional')}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-50 border border-zinc-200 text-zinc-600 hover:bg-zinc-100 text-xs font-semibold py-2.5 rounded-xl transition-colors">
                        <Unlock className="w-3.5 h-3.5" /> Unlock
                      </button>
                    ) : appt.schedule_status !== 'confirmed' && (
                      <button onClick={() => onSetScheduleStatus?.(appt.id, 'locked')}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold py-2.5 rounded-xl transition-colors">
                        <Lock className="w-3.5 h-3.5" /> Lock Time
                      </button>
                    )}
                    {appt.schedule_status !== 'confirmed' ? (
                      <button onClick={() => onSetScheduleStatus?.(appt.id, 'confirmed')}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold py-2.5 rounded-xl transition-colors">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Time
                      </button>
                    ) : (
                      <button onClick={() => onSetScheduleStatus?.(appt.id, 'provisional')}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-50 border border-zinc-200 text-zinc-600 hover:bg-zinc-100 text-xs font-semibold py-2.5 rounded-xl transition-colors">
                        <Unlock className="w-3.5 h-3.5" /> Unlock
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Client contact */}
              {!isBlock && (appt.phone || appt.email) && (
                <div className="space-y-1.5">
                  {appt.phone && (
                    <div className="flex items-center gap-2 text-sm text-zinc-600">
                      <Phone className="w-3.5 h-3.5 shrink-0 text-zinc-500" /><span>{appt.phone}</span>
                    </div>
                  )}
                  {appt.email && (
                    <div className="flex items-center gap-2 text-sm text-zinc-600">
                      <Mail className="w-3.5 h-3.5 shrink-0 text-zinc-500" /><span className="truncate">{appt.email}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Booking address */}
              {!isBlock && appt.address && (
                <div className="flex items-start gap-2 text-sm text-zinc-600">
                  <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-zinc-500" />
                  <span className="leading-snug">{appt.address}</span>
                </div>
              )}

              {/* Services — each participant separately, never one flat list for a group */}
              {!isBlock && (
                <div className="bg-white border border-zinc-200 rounded-xl p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Scissors className="w-3.5 h-3.5 shrink-0 text-[#7c3aed]" />
                    <span className="truncate text-xs font-semibold text-zinc-700">Services</span>
                    {appt.isGroup && (
                      <span className="ml-auto rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">
                        {participants.length || 0} people
                      </span>
                    )}
                  </div>
                  {participants.length > 0 ? (
                    <div className="space-y-2">
                      {participants.map((person, i) => (
                        <div key={i} className="space-y-0.5">
                          {participants.length > 1 && (
                            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Person {i + 1}</p>
                          )}
                          <p className="text-sm text-zinc-800">{person.primary_service || 'No service'}</p>
                          {(person.addons || []).length > 0 && (
                            <p className="text-[11px] text-zinc-500">+ {person.addons.join(', ')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (appt.services?.length > 0) ? (
                    <div className="space-y-1">
                      {appt.services.map((s, i) => (
                        <span key={i} className="block text-sm text-zinc-800">{s}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">No services</p>
                  )}
                  {appt.price > 0 && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-100">
                      <span className="text-xs text-zinc-500">Price</span>
                      <span className="text-sm font-bold text-zinc-900">${Number(appt.price).toFixed(2)}</span>
                    </div>
                  )}
                  {appt.isGroup && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-zinc-500">
                      <Info className="mt-px h-3 w-3 shrink-0 text-zinc-400" />
                      Group booking — edit each person&apos;s service with Edit Booking.
                    </p>
                  )}
                </div>
              )}

              {/* Notes */}
              {!isBlock && (
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Notes</label>
                  <p className="text-sm text-zinc-500 whitespace-pre-wrap">{appt.notes || '—'}</p>
                </div>
              )}

              {/* Open Client link */}
              {!isBlock && appt.clientName && (
                <Link
                  to="/admin/clients"
                  onClick={onClose}
                  className="flex items-center gap-2 text-xs text-[#6d28d9] hover:underline"
                >
                  <User className="w-3.5 h-3.5" /> Open Client Profile
                </Link>
              )}

              {/* Messages — beneath every booking detail */}
              {!isBlock && appt.requestId && <BookingMessages bookingId={appt.requestId} />}
            </div>

            {/* Action footer */}
            <div className="border-t border-zinc-200 p-4 space-y-2 shrink-0 bg-white">
              {isActive && !isBlock && (
                <>
                  {appt.availability_override && appt.override_status === 'awaiting_confirmation' && (
                    <button onClick={() => onConfirmOverride?.(appt.id)}
                      className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold py-2.5 rounded-xl transition-colors mb-2">
                      <CheckCircle2 className="w-4 h-4" /> Mark Client Confirmed
                    </button>
                  )}
                  <button onClick={() => onComplete(appt.id)}
                    className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 text-white text-sm font-bold py-2.5 rounded-xl transition-colors">
                    <CheckCircle2 className="w-4 h-4" /> Mark Completed
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCancelConfirm(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 border border-red-500/30 text-red-600 hover:bg-red-500/10 text-xs font-semibold py-2.5 rounded-xl transition-colors">
                      <XCircle className="w-3.5 h-3.5" /> Cancel
                    </button>
                    <button onClick={() => onNoShow(appt.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 text-xs font-semibold py-2.5 rounded-xl transition-colors">
                      <AlertCircle className="w-3.5 h-3.5" /> No-show
                    </button>
                    <button onClick={() => setShowRemoveConfirm(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 border border-border text-muted-foreground hover:bg-muted text-xs font-semibold py-2.5 rounded-xl transition-colors">
                      <RotateCcw className="w-3.5 h-3.5" /> Remove
                    </button>
                  </div>
                </>
              )}
              {isBlock && isActive && (
                <button onClick={() => setShowRemoveConfirm(true)}
                  className="w-full border border-border text-muted-foreground hover:bg-muted text-sm font-semibold py-2.5 rounded-xl transition-colors">
                  Remove Block
                </button>
              )}
              {!isActive && (
                <p className="text-center text-xs text-zinc-500 py-2">{statusCfg.label}</p>
              )}
              {!isBlock && (
                <button
                  onClick={() => onToggleFavourite?.(appt)}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 border text-xs font-semibold py-2.5 rounded-xl transition-colors',
                    appt.is_favourite
                      ? 'border-[#6366f1] text-indigo-600 hover:bg-indigo-50'
                      : 'border-[#6366f1]/40 text-zinc-600 hover:bg-indigo-50'
                  )}
                >
                  <Star className={cn('w-3.5 h-3.5', appt.is_favourite ? 'fill-amber-400 text-amber-600' : 'text-amber-600')} />
                  {appt.is_favourite ? 'Remove Favourite' : 'Add to Favourites'}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Remove confirm */}
      {showRemoveConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6">
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 w-full max-w-xs space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-zinc-900">Remove from schedule?</h3>
            <p className="text-sm text-zinc-500">This will return the request to the requests pool. The booking record is kept.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowRemoveConfirm(false)} className="flex-1 border border-zinc-200 text-sm font-semibold py-2.5 rounded-xl hover:bg-zinc-50 text-zinc-700">Keep</button>
              <button onClick={() => { setShowRemoveConfirm(false); onRemove(appt.id); onClose(); }} className="flex-1 bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-red-700">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirm */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6">
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-zinc-900">Cancel this appointment?</h3>
            <p className="text-sm text-zinc-500">The appointment will be marked cancelled and kept in history.</p>
            {appt.requestId && <CancelDepositChoice bookingId={appt.requestId} onChange={setDeposit} />}
            <div className="flex gap-3">
              <button onClick={() => setShowCancelConfirm(false)} className="flex-1 border border-zinc-200 text-sm font-semibold py-2.5 rounded-xl hover:bg-zinc-50 text-zinc-700">Keep</button>
              <button
                disabled={!deposit.ready}
                onClick={() => { setShowCancelConfirm(false); onCancel(appt.id, deposit.decision ? { deposit_decision: deposit.decision, expected_op_seq: deposit.opSeq } : {}); }}
                className="flex-1 bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-red-700 disabled:opacity-50"
              >Cancel It</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}