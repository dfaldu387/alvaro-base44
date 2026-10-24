import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { when } from '@/lib/conversations';

/** Customer's reply to the arrival-time text, shown in the appointment details. */
export default function ReplyStatusBadge({ appt }) {
  if (appt.needs_attention) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-800">Needs attention</p>
          <p className="text-[11px] text-amber-700 break-words">Customer replied: "{appt.attention_reply}". The booking has not been changed.</p>
        </div>
      </div>
    );
  }
  if (appt.customer_confirmed) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-bold text-emerald-800">Customer confirmed</p>
          {appt.customer_confirmed_at && <p className="text-[11px] text-emerald-700">Replied {when(appt.customer_confirmed_at)}</p>}
        </div>
      </div>
    );
  }
  return null;
}