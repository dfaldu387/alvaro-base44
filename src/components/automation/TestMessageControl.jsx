import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { asList } from '@/lib/automation';

const PHONE = /^(\+61|0061|61|0)[2-478]\d{8}$/;
const errText = (e) => e?.response?.data?.error || e?.message || 'Could not create the test item.';

/**
 * Creates one outbox item through the existing enqueueMessage endpoint, linked to an
 * existing TEST client. The sweep suppresses anything linked to test data before it
 * reaches any sender, so this can never reach a real customer.
 */
export default function TestMessageControl({ onCreated }) {
  const [testClient, setTestClient] = useState(undefined);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const clean = phone.replace(/[\s\-()]/g, '');
  const valid = PHONE.test(clean);

  useEffect(() => {
    base44.entities.ReminderClient.filter({ is_test: true }, { limit: 1 })
      .then((r) => setTestClient(asList(r)[0] || null)).catch(() => setTestClient(null));
  }, []);

  const send = async () => {
    if (!window.confirm('Create a TEST outbox item? It is linked to a test client, so it will be suppressed and never delivered.')) return;
    setBusy(true); setResult(null);
    try {
      const r = (await base44.functions.invoke('enqueueMessage', {
        channel: 'sms', to_address: clean, template_key: 'booking_received',
        payload: { name: 'Test', date: 'Test date', window: 'Test window' },
        client_id: testClient.id, idempotency_key: `sms|${testClient.id}|admin_test|${Date.now()}`,
      })).data;
      setResult({ ok: true, text: `Test item created (${r.message_outbox?.id}). Test mode — not delivered.` });
      onCreated();
    } catch (e) { setResult({ ok: false, text: errText(e) }); }
    setBusy(false);
  };

  return (
    <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Send test message</h2>
      <p className="text-xs text-zinc-500">Test mode — not delivered. Adds a test item to the real outbox. It is tied to a test client, so the sweep suppresses it as test data before any sender is used.</p>
      {testClient === null && <p className="text-xs text-red-600">Disabled: no test client exists to attach the test item to. Mark or create a test client first.</p>}
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Recipient number, e.g. 0412 345 678" inputMode="tel" disabled={!testClient} />
      {phone && !valid && <p className="text-xs text-red-600">Enter a valid Australian number.</p>}
      <Button size="sm" onClick={send} disabled={!testClient || !valid || busy}>{busy ? 'Creating…' : 'Create test item'}</Button>
      {result && <p className={`text-xs break-words ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.text}</p>}
    </section>
  );
}