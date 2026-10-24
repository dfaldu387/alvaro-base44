import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Phone, MessageSquare, MapPin, Mail,
  Clock, Scissors, Plus, Minus, Calendar,
  AlertTriangle, Copy, X
} from 'lucide-react';
import { decimalToLabel } from '@/lib/timeUtils';
import TimeSelect from '@/components/ui/TimeSelect';
import { base44 } from '@/api/base44Client';
import { applyManualPlacement } from '@/lib/manualPlacement';
import { updateBookingRequest } from '@/lib/requestAdmin';
import { placementErrorMessage } from '@/lib/placementValidation';

// Look up service duration/price from the available services catalogue by name
function lookupService(name, catalogue) {
  if (!catalogue?.length) return { duration_mins: 30, price: 0 };
  const found = catalogue.find(s => s.name === name);
  return found ? { duration_mins: found.duration_mins || 30, price: found.price || 0 } : { duration_mins: 30, price: 0 };
}

function calcTotals(serviceNames, catalogue) {
  const duration = serviceNames.reduce((sum, name) => sum + lookupService(name, catalogue).duration_mins, 0) || 30;
  const price = serviceNames.reduce((sum, name) => sum + lookupService(name, catalogue).price, 0);
  return { duration, price };
}

export const STATUS_CONFIG = {
  draft:             { label: 'Draft',           color: 'text-violet-700',  bg: 'bg-purple-500/20',  border: 'border-purple-500/30',  dot: 'bg-purple-500' },
  scheduled:         { label: 'Scheduled',        color: 'text-blue-700',    bg: 'bg-blue-500/20',    border: 'border-blue-500/30',    dot: 'bg-blue-500' },
  completed:         { label: 'Completed',        color: 'text-emerald-600',   bg: 'bg-green-700/20',   border: 'border-green-700/30',   dot: 'bg-green-700' },
  cancelled:         { label: 'Cancelled',        color: 'text-muted-foreground', bg: 'bg-muted',    border: 'border-border',         dot: 'bg-muted-foreground' },
  no_show:           { label: 'No-show',          color: 'text-red-700',     bg: 'bg-red-500/20',     border: 'border-red-500/30',     dot: 'bg-red-500' },
  rescheduled:      { label: 'Rescheduled',      color: 'text-orange-300',  bg: 'bg-orange-500/20',  border: 'border-orange-500/30',  dot: 'bg-orange-500' },
  blocked:          { label: 'Blocked',          color: 'text-zinc-500',    bg: 'bg-zinc-500/20',    border: 'border-zinc-500/30',    dot: 'bg-zinc-500' },
  // Legacy compatibility
  planned:           { label: 'Scheduled',        color: 'text-blue-700',    bg: 'bg-blue-500/20',    border: 'border-blue-500/30',    dot: 'bg-blue-500' },
  window_confirmed:  { label: 'Scheduled',        color: 'text-blue-700',    bg: 'bg-blue-500/20',    border: 'border-blue-500/30',    dot: 'bg-blue-500' },
  waiting:           { label: 'Scheduled',        color: 'text-blue-700',    bg: 'bg-blue-500/20',    border: 'border-blue-500/30',    dot: 'bg-blue-500' },
  client_confirmed:  { label: 'Scheduled',        color: 'text-blue-700',    bg: 'bg-blue-500/20',    border: 'border-blue-500/30',    dot: 'bg-blue-500' },
};

const EDIT_WARNINGS = {
  window_confirmed: 'This client has already been told their booking is confirmed within this window. If you change the window, you may need to send an update.',
  waiting: 'The arrival time has already been sent. If you change the time, you may need to resend the arrival time.',
  client_confirmed: 'This client has already confirmed the arrival time. Changing it may require reconfirmation.',
};

function formatOrdinal(n) {
  if (n === 1 || n === 21 || n === 31) return `${n}st`;
  if (n === 2 || n === 22) return `${n}nd`;
  if (n === 3 || n === 23) return `${n}rd`;
  return `${n}th`;
}

export default function AppointmentDetail({ appt, allAppointments, onBack, onUpdate, onRemove, onConfirm, onSendTime, onComplete, onCancel, onNoShow, onAddToast }) {
  // A service change alters the appointment length. The services are saved, then the
  // unchanged start time is re-checked by the shared backend validator — this
  // component never writes a time itself.
  // The server recalculates duration and price from the catalogue (the numbers
  // shown here are only a preview), checks permission and records who changed it.
  const persistServices = async (updated) => {
    if (!appt.requestId) return;
    if (appt.isGroup) {
      onAddToast?.({ message: 'Group booking: change its services with Edit on the booking in Bookings.', type: 'error' });
      return;
    }
    const saved = await updateBookingRequest({ booking_request_id: appt.requestId, services: updated });
    if (saved?.saved !== true) {
      onAddToast?.({ message: 'Could not save the services', description: saved?.error, type: 'error' });
      return;
    }
    // A provisional slot was released and Route Flow re-placed it. A locked or
    // confirmed time stays put, so its new length is re-checked at that time.
    if (saved.released_slot === true) {
      if (saved.route_flow?.placed !== true) onAddToast?.({ message: 'Services saved, but the booking needs a new time', description: saved.route_flow?.message, type: 'info' });
      return;
    }
    const checked = await applyManualPlacement({
      requestId: appt.requestId,
      startDecimal: appt.apptStart,
      date: appt.date,
      barberId: appt.teamMemberId || null,
      note: 'Services changed',
    });
    if (!checked || checked.saved !== true) {
      onAddToast?.({ message: placementErrorMessage(checked?.result) || checked?.error || 'The new length does not pass the schedule check.', type: 'error' });
    }
  };

  const [defaultBuffer, setDefaultBuffer] = useState(appt.defaultBuffer ?? 0);
  const [extraBuffer, setExtraBuffer] = useState(appt.extraBuffer ?? 0);
  const [editingBuffer, setEditingBuffer] = useState(false);
  const [apptNotes, setApptNotes] = useState(appt.notes || '');
  const [editingApptNotes, setEditingApptNotes] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [copied, setCopied] = useState(null);
  const [editingTiming, setEditingTiming] = useState(false);
  const [editWindow, setEditWindow] = useState({ windowStart: appt.windowStart, windowEnd: appt.windowEnd, apptStart: appt.apptStart });
  const [availableServices, setAvailableServices] = useState([]);
  const [showAddService, setShowAddService] = useState(false);

  useEffect(() => {
    base44.entities.Service.list('sort_order', 20).then(setAvailableServices);
  }, []);

  const totalBuffer = defaultBuffer + extraBuffer;
  const totalProtected = appt.duration + totalBuffer;
  const statusCfg = STATUS_CONFIG[appt.status] || STATUS_CONFIG.planned;
  const editWarning = EDIT_WARNINGS[appt.status];

  // SMS messages
  const today = new Date();
  const dateStr = `${appt.day} ${formatOrdinal(today.getDate())} ${['January','February','March','April','May','June','July','August','September','October','November','December'][today.getMonth()]}`;
  const windowMsg = `Hey ${appt.clientName?.split(' ')[0]}, your Cut Deluxe booking is confirmed for ${dateStr} between ${decimalToLabel(appt.windowStart)}–${decimalToLabel(appt.windowEnd)}. Your exact arrival time will be sent the day before your appointment.`;
  const arrivalMsg = `Hey ${appt.clientName?.split(' ')[0]}, your barber is scheduled to arrive tomorrow at approximately ${decimalToLabel(appt.apptStart)}. Reply YES to confirm, or NO if you need to cancel or reschedule.`;

  const copyToClipboard = (text, key) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const saveBuffer = () => {
    const bufferHrs = (defaultBuffer + extraBuffer) / 60;
    onUpdate(appt.id, { defaultBuffer, extraBuffer, bufferEnd: appt.apptEnd + bufferHrs });
    setEditingBuffer(false);
    onAddToast?.({ message: 'Buffer updated', type: 'success' });
  };

  const saveTiming = () => {
    const dur = appt.apptEnd - appt.apptStart;
    const bufDur = (appt.bufferEnd || appt.apptEnd) - appt.apptEnd;
    const newStart = editWindow.apptStart;
    // Validate: service must fit inside window
    if (newStart < editWindow.windowStart || newStart + dur > editWindow.windowEnd) {
      onAddToast?.({ message: 'Placed time does not fit inside the availability window', type: 'error' });
      return;
    }
    onUpdate(appt.id, {
      apptStart: newStart,
      apptEnd: newStart + dur,
      bufferEnd: newStart + dur + bufDur,
      windowStart: editWindow.windowStart,
      windowEnd: editWindow.windowEnd,
    });
    setEditingTiming(false);
    onAddToast?.({ message: 'Timing updated', type: 'success' });
  };

  const handleRemoveConfirmed = () => {
    setShowRemoveConfirm(false);
    onRemove(appt.id);
  };

  // Bottom action buttons by status
  const renderActions = () => {
    const s = appt.status;
    const isActive = ['draft', 'scheduled', 'planned', 'window_confirmed', 'waiting', 'client_confirmed'].includes(s);
    return (
      <div className="fixed bottom-16 left-0 right-0 z-30 bg-card border-t border-border px-4 py-3 flex gap-2">
        {isActive && (
          <>
            <button
              onClick={() => onComplete(appt.id)}
              className="flex-1 bg-green-700 text-white text-xs font-bold py-2.5 rounded-xl hover:bg-green-800 transition-all"
            >
              Mark Completed
            </button>
            <button
              onClick={() => onCancel(appt.id)}
              className="px-3 py-2.5 rounded-xl border border-red-500/30 text-xs font-semibold text-red-600 hover:bg-red-500/10 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => onNoShow(appt.id)}
              className="px-3 py-2.5 rounded-xl border border-orange-500/30 text-xs font-semibold text-orange-400 hover:bg-orange-500/10 transition-all"
            >
              No-show
            </button>
            <button
              onClick={() => setShowRemoveConfirm(true)}
              className="px-3 py-2.5 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted transition-all"
            >
              Remove
            </button>
          </>
        )}
        {!isActive && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
            {statusCfg.label}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-bold text-foreground">{appt.clientName}</h1>
          <div className="flex items-center gap-3">
            {appt.phone && (
              <a href={`tel:${appt.phone}`} className="text-muted-foreground hover:text-foreground flex flex-col items-center gap-0.5">
                <Phone className="w-4 h-4" /><span className="text-[9px]">Call</span>
              </a>
            )}
            {appt.phone && (
              <a href={`sms:${appt.phone}`} className="text-muted-foreground hover:text-foreground flex flex-col items-center gap-0.5">
                <MessageSquare className="w-4 h-4" /><span className="text-[9px]">Message</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="p-4 space-y-3">

          {/* Edit warning banner */}
          {editWarning && (
            <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">{editWarning}</p>
            </div>
          )}

          {/* Client Info */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-lg font-bold text-foreground">
                {(appt.clientName || '?').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-bold text-foreground">{appt.clientName}</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusCfg.color} ${statusCfg.bg} ${statusCfg.border}`}>
                  {statusCfg.label}
                </span>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              {appt.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3.5 h-3.5 shrink-0" /><span>{appt.phone}</span></div>}
              {appt.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{appt.email}</span></div>}
              {appt.address && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-3.5 h-3.5 shrink-0" /><span>{appt.address}</span></div>}
            </div>
          </div>

          {/* Appointment Timing */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Appointment Timing</h3>
              </div>
              <button
                onClick={() => { setEditWindow({ windowStart: appt.windowStart, windowEnd: appt.windowEnd, apptStart: appt.apptStart }); setEditingTiming(p => !p); }}
                className="text-xs text-muted-foreground border border-border px-2.5 py-1 rounded-lg hover:bg-muted"
              >
                {editingTiming ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {editingTiming ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Placed Start Time</label>
                  <TimeSelect value={editWindow.apptStart} onChange={v => setEditWindow(p => ({ ...p, apptStart: v }))} className="w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Window Start</label>
                    <TimeSelect value={editWindow.windowStart} onChange={v => setEditWindow(p => ({ ...p, windowStart: v }))} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Window End</label>
                    <TimeSelect value={editWindow.windowEnd} onChange={v => setEditWindow(p => ({ ...p, windowEnd: v }))} className="w-full" />
                  </div>
                </div>
                {editWindow.apptStart != null && appt.apptEnd - appt.apptStart > 0 && (
                  (() => {
                    const dur = appt.apptEnd - appt.apptStart;
                    const newEnd = editWindow.apptStart + dur;
                    const fits = editWindow.apptStart >= editWindow.windowStart && newEnd <= editWindow.windowEnd;
                    return !fits ? (
                      <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <p className="text-xs text-amber-700">Service does not fit inside this window.</p>
                      </div>
                    ) : null;
                  })()
                )}
                <button onClick={saveTiming} className="w-full bg-primary text-primary-foreground text-sm font-semibold py-2 rounded-xl">Save</button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Day</p>
                  <p className="text-sm font-bold text-foreground">{appt.day}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Placed Time</p>
                  <p className="text-sm font-bold text-foreground">{decimalToLabel(appt.apptStart)}–{decimalToLabel(appt.apptEnd)}</p>
                  <p className="text-xs text-muted-foreground">{appt.duration} mins</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Client Window</p>
                  <p className="text-sm font-bold text-foreground">{decimalToLabel(appt.windowStart)}–{decimalToLabel(appt.windowEnd)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Services & Items */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Services & Items</h3>
              </div>
              <button onClick={() => setShowAddService(p => !p)} className="text-xs text-primary border border-primary/30 px-2.5 py-1 rounded-lg hover:bg-primary/10 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {appt.services?.length > 0 ? (
              <div className="space-y-1.5 mb-2">
                {appt.services.map((svc, i) => {
                  const info = lookupService(svc, availableServices);
                  return (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                          <Scissors className="w-3 h-3 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{svc}</p>
                          <p className="text-xs text-muted-foreground">{info.duration_mins} min · ${info.price}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const updated = appt.services.filter((_, idx) => idx !== i);
                          const { duration, price } = calcTotals(updated, availableServices);
                          const durHrs = duration / 60;
                          const bufHrs = ((appt.defaultBuffer ?? 0) + (appt.extraBuffer ?? 0)) / 60;
                          const newApptEnd = appt.apptStart + durHrs;
                          const newBufferEnd = newApptEnd + bufHrs;
                          // Warn if service no longer fits window
                          if (appt.windowEnd && newApptEnd > appt.windowEnd) {
                            onAddToast?.({ message: 'Warning: service no longer fits inside client window', type: 'error' });
                          }
                          onUpdate(appt.id, {
                            services: updated,
                            duration,
                            price,
                            apptEnd: newApptEnd,
                            bufferEnd: newBufferEnd,
                          });
                          persistServices(updated);
                        }}
                        className="text-muted-foreground hover:text-red-600 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-2">No services specified</p>
            )}
            {showAddService && availableServices.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">Tap to add:</p>
                <div className="flex flex-wrap gap-2">
                  {availableServices.map(svc => (
                    <button key={svc.id} onClick={() => {
                      const updated = [...(appt.services || []), svc.name];
                      const { duration, price } = calcTotals(updated, availableServices);
                      const durHrs = duration / 60;
                      const bufHrs = ((appt.defaultBuffer ?? 0) + (appt.extraBuffer ?? 0)) / 60;
                      const newApptEnd = appt.apptStart + durHrs;
                      const newBufferEnd = newApptEnd + bufHrs;
                      // Warn if service no longer fits window
                      if (appt.windowEnd && newApptEnd > appt.windowEnd) {
                        onAddToast?.({ message: 'Warning: service does not fit inside client window', type: 'error' });
                      }
                      onUpdate(appt.id, {
                        services: updated,
                        duration,
                        price,
                        apptEnd: newApptEnd,
                        bufferEnd: newBufferEnd,
                      });
                      persistServices(updated);
                      setShowAddService(false);
                    }} className="text-xs font-medium px-3 py-1.5 rounded-xl border border-border bg-muted/30 hover:bg-primary/10 hover:border-primary/40 transition-all">
                      {svc.name} — ${svc.price} · {svc.duration_mins}min
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(() => {
              const { duration: calcDur, price: calcPrice } = calcTotals(appt.services || [], availableServices);
              return (
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Total: <span className="text-foreground font-medium">{calcDur} mins</span></p>
                  {calcPrice > 0 && <p className="text-xs font-semibold text-primary">${calcPrice}</p>}
                </div>
              );
            })()}
          </div>

          {/* Timing & Buffer */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Timing & Buffer</h3>
              </div>
              <button onClick={() => setEditingBuffer(p => !p)} className="text-xs text-muted-foreground border border-border px-2.5 py-1 rounded-lg hover:bg-muted">
                {editingBuffer ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {editingBuffer ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Default Buffer (mins)</label>
                    <input type="number" value={defaultBuffer} onChange={e => setDefaultBuffer(Number(e.target.value))} className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm border border-border" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Extra Client Buffer (mins)</label>
                    <input type="number" value={extraBuffer} onChange={e => setExtraBuffer(Number(e.target.value))} className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm border border-border" />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Total Protected: {appt.duration} + {defaultBuffer} + {extraBuffer} = <strong className="text-primary">{appt.duration + defaultBuffer + extraBuffer} mins</strong>
                </div>
                <button onClick={saveBuffer} className="w-full bg-primary text-primary-foreground text-sm font-semibold py-2 rounded-xl">Save</button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                <div><p className="text-xs text-muted-foreground mb-1">Service</p><p className="text-sm font-bold text-foreground">{appt.duration} min</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">Default Buffer</p><p className="text-sm font-bold text-foreground">{defaultBuffer} min</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">Extra Buffer</p><p className="text-sm font-bold text-foreground">{extraBuffer} min</p></div>
                <div><p className="text-xs text-muted-foreground mb-1">Total Protected</p><p className="text-sm font-bold text-primary">{totalProtected} min</p></div>
              </div>
            )}
          </div>

          {/* SMS Messages */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">SMS Templates</h3>
            <div className="space-y-2">
              <div className="bg-muted/40 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-muted-foreground">Window Confirmed</p>
                  <button onClick={() => copyToClipboard(windowMsg, 'window')} className="text-xs text-primary font-semibold flex items-center gap-1">
                    <Copy className="w-3 h-3" />{copied === 'window' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-foreground/80 leading-relaxed">{windowMsg}</p>
              </div>
              <div className="bg-muted/40 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-muted-foreground">Arrival Time</p>
                  <button onClick={() => copyToClipboard(arrivalMsg, 'arrival')} className="text-xs text-primary font-semibold flex items-center gap-1">
                    <Copy className="w-3 h-3" />{copied === 'arrival' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-foreground/80 leading-relaxed">{arrivalMsg}</p>
              </div>
            </div>
          </div>

          {/* Appointment Notes */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground">Appointment Notes</h3>
              <button onClick={() => setEditingApptNotes(p => !p)} className="text-xs text-muted-foreground border border-border px-2.5 py-1 rounded-lg hover:bg-muted">
                {editingApptNotes ? 'Done' : 'Edit'}
              </button>
            </div>
            {editingApptNotes ? (
              <textarea value={apptNotes} onChange={e => setApptNotes(e.target.value)} rows={3} placeholder="Gate code, parking, first-time consultation..." className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm border border-border resize-none" />
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">{apptNotes || 'No appointment notes.'}</p>
            )}
          </div>

        </div>
      </div>

      {/* Remove confirm modal */}
      {showRemoveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-bold text-foreground">Remove from schedule?</h3>
            <p className="text-sm text-muted-foreground">This will return the request to the Requests drawer. The booking will not be deleted.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowRemoveConfirm(false)} className="flex-1 border border-border text-sm font-semibold py-2.5 rounded-xl hover:bg-muted transition-all">Cancel</button>
              <button onClick={handleRemoveConfirmed} className="flex-1 bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-red-700 transition-all">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Actions */}
      {renderActions()}
    </div>
  );
}