import React, { useState } from 'react';
import { ArrowLeft, Pencil, MapPin, AlertCircle, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

// Step 5 — Review: "Review your request"
// Read-only summary with Edit actions for each step. Edit returns to the
// correct step and preserves all existing booking state.
export default function ReviewStep({
  selectedArea,
  priorityZones,
  priorityStatus,
  personItems,
  participants,
  selectedDay,
  formattedDate,
  availabilityLabel,
  bookingMode,
  afterHoursMode,
  afterHoursSlot,
  clientName,
  phone,
  email,
  address,
  notes,
  subtotal,
  totalSavings,
  totalPrice,
  totalMins,
  peopleCount,
  isGroupBooking,
  primaryServiceCount,
  addonCount,
  onEditStep,
  onUpdateContactDetails,
  onSubmit,
  submitting,
  showSlowNotice,
  submitError,
  onBack,
  regionNotice,
  depositQuote = null,
}) {
  const isOutside = priorityStatus === 'outside_priority';

  // ── Inline contact details editing ──
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editForm, setEditForm] = useState({ clientName, phone, email, notes });
  const [editErrors, setEditErrors] = useState({});

  const startContactEdit = () => {
    setEditForm({ clientName, phone, email, notes });
    setEditErrors({});
    setIsEditingContact(true);
  };
  const cancelContactEdit = () => {
    setIsEditingContact(false);
    setEditErrors({});
  };
  const validateAuPhone = (v) => /^(\+?61\s?)?0?4\d{2}\s?\d{3}\s?\d{3}$/.test(v.trim());
  const validateEmailFmt = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const saveContactEdit = () => {
    const errors = {};
    if (!editForm.clientName.trim() || editForm.clientName.trim().length < 2) errors.clientName = 'Please enter your full name.';
    if (!validateAuPhone(editForm.phone)) errors.phone = 'Please enter a valid Australian mobile number.';
    if (editForm.email.trim() && !validateEmailFmt(editForm.email)) errors.email = 'Please enter a valid email address.';
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    onUpdateContactDetails(editForm);
    setIsEditingContact(false);
  };

  return (
    <div className="space-y-5 pb-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground -mt-2">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div>
        <h2 className="text-xl font-heading font-bold">Review your request</h2>
        <p className="text-sm text-muted-foreground mt-1">Check your details before submitting your request.</p>
      </div>

      {/* Region change notice */}
      {regionNotice && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200 leading-relaxed">{regionNotice}</p>
        </div>
      )}

      {/* Priority Area — derived from selected date + backend zone config.
          Read-only: customers edit their Service Address or Availability Date,
          and the priority area updates automatically. */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {priorityZones.length > 1 ? 'Priority Areas for This Date' : 'Priority Area for This Date'}
          </p>
        </div>
        <div className="px-4 py-3">
          {isOutside ? (
            <div className="flex items-center gap-2.5">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Outside priority area</p>
            </div>
          ) : priorityZones.length > 0 ? (
            <div className="space-y-2">
              {priorityZones.map((z, i) => (
                <div key={z.id || i} className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: z.colour || '#6f22cf' }} />
                  <p className="text-sm font-semibold text-foreground">{z.name}</p>
                </div>
              ))}
            </div>
          ) : selectedArea ? (
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedArea.colour || '#6f22cf' }} />
              <p className="text-sm font-semibold text-foreground">{selectedArea.name}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Outside priority area</p>
            </div>
          )}
        </div>
      </div>

      {/* People & Services */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">People & Services</p>
          <button onClick={() => onEditStep(2)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
            <Pencil className="w-3 h-3" /> Edit
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {personItems.map(({ primary, addons: pAddons }, i) => {
            const pTotal = (primary ? primary.price : 0) + pAddons.reduce((sum, a) => sum + (a.price_adjustment || 0), 0);
            const pLabel = primary
              ? (pAddons.length > 0 ? `${primary.name} + ${pAddons.map(a => a.name).join(', ')}` : primary.name)
              : null;
            return (
              <div key={participants[i].id} className="rounded-xl border border-border bg-muted/20 px-3 py-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-semibold text-foreground">Person {i + 1}</p>
                  <p className="text-xs text-muted-foreground">${pTotal}</p>
                </div>
                {pLabel ? (
                  <p className="text-xs text-muted-foreground mt-0.5">{pLabel}</p>
                ) : (
                  <p className="text-xs text-muted-foreground/60 mt-0.5">No service selected</p>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground pt-1">
            {peopleCount} {peopleCount === 1 ? 'person' : 'people'}{isGroupBooking ? ' · Group booking' : ''} · {primaryServiceCount} {primaryServiceCount === 1 ? 'primary service' : 'primary services'}{addonCount > 0 ? ` · ${addonCount} ${addonCount === 1 ? 'add-on' : 'add-ons'}` : ''} · ~{totalMins} mins
          </p>
        </div>
      </div>

      {/* Availability */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Availability</p>
          <button onClick={() => onEditStep(3)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
            <Pencil className="w-3 h-3" /> Edit
          </button>
        </div>
        <div className="divide-y divide-border">
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-0.5">Appointment Date</p>
            <p className="text-sm font-semibold text-foreground">{formattedDate}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-0.5">Availability Window</p>
            <p className="text-sm font-semibold text-foreground">{availabilityLabel}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Exact arrival time sent the day before.</p>
          </div>
          {bookingMode === 'after_hours' && afterHoursSlot && (
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-0.5">After-Hours Slot</p>
              <p className="text-sm font-semibold text-foreground">{afterHoursSlot} · {afterHoursMode === 'mobile_callout' ? 'I come to you (+$50)' : 'Come to me'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Service Address */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Service Address</p>
          <button onClick={() => onEditStep(1)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
            <Pencil className="w-3 h-3" /> Edit
          </button>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{address || 'No address selected'}</p>
        </div>
      </div>

      {/* Contact Details + Notes (inline editable) */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact Details</p>
          {!isEditingContact && (
            <button onClick={startContactEdit} className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
              <Pencil className="w-3 h-3" /> Edit
            </button>
          )}
        </div>
        {isEditingContact ? (
          <div className="divide-y divide-border">
            <div className="px-4 py-3 space-y-1.5">
              <label className="text-xs text-muted-foreground">Full Name</label>
              <Input
                value={editForm.clientName}
                onChange={e => setEditForm(prev => ({ ...prev, clientName: e.target.value }))}
                className="bg-background h-9"
              />
              {editErrors.clientName && <p className="text-xs text-red-400">{editErrors.clientName}</p>}
            </div>
            <div className="px-4 py-3 space-y-1.5">
              <label className="text-xs text-muted-foreground">Mobile Number</label>
              <Input
                value={editForm.phone}
                onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                type="tel"
                className="bg-background h-9"
              />
              {editErrors.phone && <p className="text-xs text-red-400">{editErrors.phone}</p>}
            </div>
            <div className="px-4 py-3 space-y-1.5">
              <label className="text-xs text-muted-foreground">Email Address <span className="font-normal">(optional)</span></label>
              <Input
                value={editForm.email}
                onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                type="email"
                className="bg-background h-9"
              />
              {editErrors.email && <p className="text-xs text-red-400">{editErrors.email}</p>}
            </div>
            <div className="px-4 py-3 space-y-1.5">
              <label className="text-xs text-muted-foreground">Notes for Barber <span className="font-normal">(optional)</span></label>
              <Textarea
                value={editForm.notes}
                onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={3}
                className="bg-background"
              />
            </div>
            <div className="px-4 py-3 flex gap-2">
              <Button size="sm" onClick={saveContactEdit} className="flex-1">
                <Check className="w-3.5 h-3.5" /> Save
              </Button>
              <Button size="sm" variant="outline" onClick={cancelContactEdit} className="flex-1">
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-0.5">Full Name</p>
              <p className="text-sm font-semibold text-foreground">{clientName}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-0.5">Mobile Number</p>
              <p className="text-sm font-semibold text-foreground">{phone}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-0.5">Email Address</p>
              <p className="text-sm font-semibold text-foreground break-all">{email || <span className="text-muted-foreground font-normal">Not provided</span>}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-0.5">Notes for Barber</p>
              <p className="text-sm font-semibold text-foreground whitespace-pre-wrap">{notes || <span className="text-muted-foreground font-normal">No notes</span>}</p>
            </div>
          </div>
        )}
      </div>

      {/* Price Summary */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 space-y-1.5">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Subtotal</span>
            <span>${subtotal}</span>
          </div>
          {totalSavings > 0 && (
            <div className="flex justify-between text-sm text-primary font-medium">
              <span>Group Booking Savings</span>
              <span>−${totalSavings}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-foreground pt-1.5 border-t border-border">
            <span>Total</span>
            <span className="text-primary">${totalPrice}</span>
          </div>
          {/* What the server expects to ask for. Advisory: it appears only when a quote came back. */}
          {depositQuote && (
            <div className="pt-1.5 border-t border-border space-y-0.5">
              <div className="flex justify-between text-sm font-semibold text-foreground">
                <span>Deposit due</span>
                <span className="text-primary">${depositQuote.amount.toFixed(2)}</span>
              </div>
              {depositQuote.line && <p className="text-xs text-muted-foreground">{depositQuote.line}</p>}
            </div>
          )}
        </div>
      </div>

      {submitError && (
        <div role="alert" className="flex items-start gap-2.5 bg-red-950/40 border border-red-500/30 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-200 leading-relaxed">{submitError}</p>
        </div>
      )}

      <Button className="w-full" disabled={submitting} onClick={onSubmit} aria-busy={submitting}>
        {submitting ? (
          <><div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" /> Submitting…</>
        ) : 'Submit Booking Request'}
      </Button>

      {submitting && showSlowNotice && (
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          Still saving your request — this can take a moment. Please don't close this page.
        </p>
      )}
    </div>
  );
}