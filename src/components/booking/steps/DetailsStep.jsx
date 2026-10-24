import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

// Step 4 — Details: "Your details"
// Collects contact info only. The service address is captured in Step 1
// and is the single source of truth — it is not re-entered here.
export default function DetailsStep({
  fields,
  errors,
  onChange,
  onContinue,
  onBack,
}) {
  return (
    <div className="space-y-5 pb-6">
      <button onClick={onBack} aria-label="Go back" className="flex items-center gap-1.5 text-sm text-muted-foreground -mt-2 min-h-[44px] -ml-2 px-2">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div>
        <h2 className="text-xl font-heading font-bold">Your details</h2>
        <p className="text-sm text-muted-foreground mt-1">Enter your details so we can confirm and update you about your booking request.</p>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="booking-full-name" className="text-sm font-medium text-foreground mb-1.5 block">Full Name</label>
          <Input
            id="booking-full-name"
            value={fields.clientName}
            onChange={e => onChange('clientName', e.target.value)}
            placeholder="Your full name"
            aria-invalid={!!errors.clientName}
            aria-describedby={errors.clientName ? 'err-clientName' : undefined}
            className={`bg-card ${errors.clientName ? 'border-red-500/70' : ''}`}
          />
          {errors.clientName && <p id="err-clientName" role="alert" className="text-xs text-red-400 mt-1">{errors.clientName}</p>}
        </div>
        <div>
          <label htmlFor="booking-phone" className="text-sm font-medium text-foreground mb-1.5 block">Mobile Number</label>
          <Input
            id="booking-phone"
            value={fields.phone}
            onChange={e => onChange('phone', e.target.value)}
            placeholder="0412 345 678"
            type="tel"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? 'err-phone' : undefined}
            className={`bg-card ${errors.phone ? 'border-red-500/70' : ''}`}
          />
          {errors.phone && <p id="err-phone" role="alert" className="text-xs text-red-400 mt-1">{errors.phone}</p>}
        </div>
        <div>
          <label htmlFor="booking-email" className="text-sm font-medium text-foreground mb-1.5 block">
            Email Address <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            id="booking-email"
            value={fields.email}
            onChange={e => onChange('email', e.target.value)}
            placeholder="you@email.com"
            type="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'err-email' : undefined}
            className={`bg-card ${errors.email ? 'border-red-500/70' : ''}`}
          />
          {errors.email && <p id="err-email" role="alert" className="text-xs text-red-400 mt-1">{errors.email}</p>}
        </div>
        <div>
          {/* For a service that drives to the customer, these details decide whether the
              barber can reach the door. It was an optional "Notes for Barber" box at the
              end of the form, which reads as an afterthought; it asks plainly now. */}
          <label htmlFor="booking-notes" className="text-sm font-medium text-foreground mb-1.5 block">
            How will your barber find you? <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <p className="mb-1.5 text-xs leading-relaxed text-muted-foreground">
            Your barber drives to you and parks nearby. Anything that helps saves time on the day.
          </p>
          <Textarea
            id="booking-notes"
            value={fields.notes}
            onChange={e => onChange('notes', e.target.value)}
            placeholder="Unit number, gate or buzzer code, where to park, which door to use..."
            rows={3}
            className="bg-card"
          />
        </div>
        <label htmlFor="booking-messaging-consent" className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 cursor-pointer">
          <input
            id="booking-messaging-consent"
            type="checkbox"
            checked={fields.messagingConsent === true}
            onChange={e => onChange('messagingConsent', e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
          />
          <span className="text-sm text-foreground leading-snug">
            I agree to receive text messages from Cut Deluxe about this booking, such as confirmations, changes and arrival times.
            <span className="block text-xs text-muted-foreground mt-1">Reply STOP at any time to opt out.</span>
          </span>
        </label>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          We use your details to schedule and run your appointment. See our{' '}
          <Link to="/privacy" className="text-foreground underline underline-offset-2 hover:text-foreground/80">privacy policy</Link>
          {' '}and{' '}
          <Link to="/terms" className="text-foreground underline underline-offset-2 hover:text-foreground/80">terms</Link>.
        </p>
      </div>

      <Button className="w-full" onClick={onContinue}>
        Continue to Review
      </Button>
    </div>
  );
}