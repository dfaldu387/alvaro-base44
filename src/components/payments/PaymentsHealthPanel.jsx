import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import AdminCard from '@/components/admin/ui/AdminCard';
import { cn } from '@/lib/utils';

// Read-only. Which provider is active (and whether it is sandbox or production), plus webhook counts.
// The server decides all of this from Secrets; nothing here can switch anything.
function banner(h) {
  if (h.provider === 'square' && h.environment === 'production') {
    return { tone: 'bg-red-600 text-white border-red-700', title: 'LIVE: Square production', text: 'Real money. Customers pay for real and refunds move real money.' };
  }
  if (h.provider === 'square') {
    return { tone: 'bg-amber-100 text-amber-900 border-amber-300', title: 'Square SANDBOX', text: 'Test money only. Nothing here is a real payment.' };
  }
  if (h.live_switch) {
    const why = h.invalid_environment ? 'SQUARE_ENVIRONMENT must be sandbox or production' : `missing: ${h.missing.join(', ')}`;
    return { tone: 'bg-amber-100 text-amber-900 border-amber-300', title: 'Payments switch is ON but Square is not ready', text: `Still SIMULATED. ${why}.` };
  }
  return { tone: 'bg-violet-50 text-violet-800 border-violet-200', title: 'SIMULATED: test payment system', text: 'No real money moves. Square is not connected.' };
}

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }) : 'Never');

export default function PaymentsHealthPanel() {
  const [h, setH] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    base44.functions.invoke('paymentsHealth', {}).then((r) => setH(r.data)).catch(() => setFailed(true));
  }, []);

  if (failed) return <AdminCard><p className="text-sm text-zinc-500">Couldn't load payment health.</p></AdminCard>;
  if (!h) return <AdminCard><p className="text-sm text-zinc-500">Loading payment health…</p></AdminCard>;

  const b = banner(h);
  const stats = [
    ['Last webhook', when(h.last_event_at)],
    ['Events applied', h.handled_count],
    ['Duplicates ignored', h.duplicates_ignored],
    ['Could not match to a booking', h.unmatched_count, h.unmatched_count > 0],
  ];
  return (
    <AdminCard className="space-y-3">
      <div className={cn('rounded-lg border px-3 py-2.5', b.tone)}>
        <p className="text-sm font-bold break-words">{b.title}</p>
        <p className="text-xs mt-0.5 break-words">{b.text}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map(([label, value, warn]) => (
          <div key={label} className="min-w-0">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className={cn('text-sm font-semibold mt-0.5 break-words', warn ? 'text-amber-700' : 'text-zinc-900')}>{value}</p>
          </div>
        ))}
      </div>
      {/* The address Square must be given, character for character: the signature is
          computed over this URL plus the raw body, so a mistyped one fails every event.
          It is null when APP_BASE_URL is not set, which is worth saying out loud -
          the same secret builds Twilio's status and inbound callback URLs. */}
      <div className="min-w-0 border-t border-zinc-200 pt-3">
        <p className="text-xs text-zinc-500">Webhook address to register with the provider</p>
        {h.webhook_url ? (
          <p className="mt-0.5 break-all font-mono text-xs text-zinc-900">{h.webhook_url}</p>
        ) : (
          <p className="mt-0.5 text-sm font-semibold text-amber-700">
            Not known — set APP_BASE_URL (an https address, no trailing slash) in Secrets.
          </p>
        )}
      </div>
    </AdminCard>
  );
}