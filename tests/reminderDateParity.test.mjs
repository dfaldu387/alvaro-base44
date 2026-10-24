// Client Workflow's manual reminder date and completing a visit must use one rule. No network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReminderFor, finishCompletion } from '../base44/shared/routeCompletion.ts';
import { loadEntry } from './helpers/loadEntry.mjs';

test('Client Workflow and completing a visit give the same reminder date for the same client', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const clients = [
    { id: 'a', frequency: 'Monthly', cadence_source: 'default', cadence_interval_days: 18, cadence_visit_count: 6 }, // measured wins
    { id: 'b', frequency: 'Fortnightly', cadence_source: 'manual', cadence_interval_days: 18, cadence_visit_count: 6 }, // a person's choice wins
    { id: 'c', frequency: 'Monthly', cadence_interval_days: 18, cadence_visit_count: 6 }, // unconfirmed Monthly keeps the label
    { id: 'd', frequency: 'Custom', custom_frequency_days: 10, cadence_source: 'manual' },
  ];
  const handler = await loadEntry('reminderAdvanceDate');
  for (const client of clients) {
    globalThis.__b44Client = () => ({
      auth: { me: async () => ({ id: 'u1', role: 'admin', email: 'a@b.c' }) },
      entities: { TeamMember: { filter: async () => [] } },
      asServiceRole: { entities: { ReminderClient: { get: async () => client }, TeamMember: { filter: async () => [] } } },
    });
    const res = await handler(new Request('http://x/', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ client_id: client.id }) }));
    const workflow = (await res.json()).date;

    // Completing a visit today. History can't be read, so the stored cadence decides (same as the workflow path).
    const updates = [];
    const admin = { entities: {
      BookingRequest: { update: async () => ({}), filter: async () => { throw new Error('no history'); } },
      ReminderClient: { get: async () => client, update: async (_id, p) => { updates.push(p); return {}; }, filter: async () => [] },
    } };
    await finishCompletion(admin, { id: 'now', status: 'pending', client_id: client.id, client_name: 'Sam', requested_date: today }, new Date().toISOString());
    const completion = updates[0].next_reminder_date ?? null;

    assert.ok(workflow, `client ${client.id}: workflow returned no date`);
    assert.equal(workflow, completion, `client ${client.id}: workflow ${workflow} vs completion ${completion}`);
    assert.equal(workflow, nextReminderFor(client, today));
  }
});

test('a client with no fixed gap gets no date from either path', async () => {
  const client = { id: 'e', frequency: 'Whenever' };
  const handler = await loadEntry('reminderAdvanceDate');
  globalThis.__b44Client = () => ({
    auth: { me: async () => ({ id: 'u1', role: 'admin', email: 'a@b.c' }) },
    entities: { TeamMember: { filter: async () => [] } },
    asServiceRole: { entities: { ReminderClient: { get: async () => client }, TeamMember: { filter: async () => [] } } },
  });
  const res = await handler(new Request('http://x/', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ client_id: 'e' }) }));
  assert.equal((await res.json()).date, null);
});