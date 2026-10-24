import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { X, CheckCircle } from 'lucide-react';

const DAYS = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function GroupBookingModal({ onClose }) {
  const [form, setForm] = useState({ client_name: '', phone: '', address: '', num_people: '', preferred_day: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await base44.functions.invoke('submitGroupEnquiry', {
        ...form,
        num_people: form.num_people ? Number(form.num_people) : undefined,
      });
      setSubmitted(true);
    } catch (e) {
      // submission failed
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-heading font-bold text-lg text-foreground">Group Booking Enquiry</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitted ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">Enquiry Submitted</p>
              <p className="text-sm text-muted-foreground">We'll be in touch to organise a custom schedule for your group.</p>
            </div>
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Name</label>
              <Input value={form.client_name} onChange={e => set('client_name', e.target.value)} placeholder="Your full name" className="bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Phone Number</label>
              <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0412 345 678" type="tel" className="bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Address / Suburb</label>
              <Input value={form.address} onChange={e => set('address', e.target.value)} placeholder="Your suburb or address" className="bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Number of People</label>
              <Input value={form.num_people} onChange={e => set('num_people', e.target.value)} placeholder="e.g. 10" type="number" min="1" className="bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Preferred Day <span className="text-muted-foreground font-normal">(optional)</span></label>
              <div className="flex gap-2 flex-wrap">
                {DAYS.map(d => (
                  <button
                    key={d}
                    onClick={() => set('preferred_day', form.preferred_day === d ? '' : d)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      form.preferred_day === d
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Additional Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any other details..." rows={3} className="bg-background" />
            </div>
            <Button
              className="w-full"
              disabled={!form.client_name || !form.phone || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              ) : 'Submit Enquiry'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}