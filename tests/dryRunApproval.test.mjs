// Two-approver rule for turning campaign dry-run OFF, plus source-level guards
// that the server (not the browser) enforces dry-run. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewRecorded, previewIds, checkApproval, isExpired, samePerson } from '../base44/shared/dryRunApproval.ts';

const run = (id) => ({ id, status: 'complete', mode: 'dry_run' });
const latest = { outreach: run('o1'), followup: run('f1') };
const now = new Date('2026-10-13T10:00:00Z');
const approval = (over = {}) => ({
  status: 'pending', requested_by_id: 'u1', requested_by_email: 'a@x.test',
  expires_at: '2026-10-14T10:00:00Z', preview_run_ids: ['o1', 'f1'], ...over,
});
const code = (r) => (r.ok ? 'ok' : r.code);

test('a recorded dry-run preview is required for BOTH stages', () => {
  assert.equal(previewRecorded(latest).ok, true);
  assert.equal(code(previewRecorded({ outreach: run('o1') })), 'PREVIEW_REQUIRED');
  assert.equal(code(previewRecorded({ outreach: run('o1'), followup: { id: 'f1', status: 'running', mode: 'dry_run' } })), 'PREVIEW_REQUIRED');
  assert.equal(code(previewRecorded({ outreach: run('o1'), followup: { id: 'f1', status: 'complete', mode: 'live' } })), 'PREVIEW_REQUIRED');
  assert.deepEqual(previewIds(latest), ['o1', 'f1']);
});

test('a different admin can approve an unexpired request for the reviewed preview', () => {
  assert.equal(code(checkApproval(approval(), { id: 'u2', email: 'b@x.test' }, latest, now)), 'ok');
});

test('the requester cannot approve their own request (by id, or by email when ids are missing)', () => {
  assert.equal(code(checkApproval(approval(), { id: 'u1' }, latest, now)), 'SAME_APPROVER');
  assert.equal(code(checkApproval(approval({ requested_by_id: undefined }), { email: 'A@X.test' }, latest, now)), 'SAME_APPROVER');
  assert.equal(samePerson({}, { id: 'u2' }), true, 'unknown identity never counts as a different person');
  assert.equal(code(checkApproval(approval(), {}, latest, now)), 'IDENTITY_REQUIRED');
});

test('expired, used, missing and stale-preview approvals are refused', () => {
  const b = { id: 'u2' };
  assert.equal(code(checkApproval(approval({ expires_at: '2026-10-13T09:59:00Z' }), b, latest, now)), 'EXPIRED');
  assert.equal(isExpired({}, now), true);
  for (const status of ['approved', 'applied', 'cancelled']) assert.equal(code(checkApproval(approval({ status }), b, latest, now)), 'NOT_PENDING', status);
  assert.equal(code(checkApproval(null, b, latest, now)), 'NO_REQUEST');
  assert.equal(code(checkApproval(approval(), b, { outreach: run('o2'), followup: run('f1') }, now)), 'PREVIEW_CHANGED');
});

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('setCampaignDryRun: admin-gated, refuses a direct OFF, rolls back if the audit write fails', () => {
  const src = read('base44/functions/setCampaignDryRun/entry.ts');
  assert.match(src, /requireAdminActor/);
  assert.match(src, /TWO_APPROVERS_REQUIRED/);
  assert.match(src, /AUTOMATION_REFUSED/);
  assert.match(src, /AUDIT_FAILED/);
  assert.match(src, /campaign_dry_run: true/);
});

test('campaignAction refuses send_now on the server while dry-run is ON', () => {
  const src = read('base44/functions/campaignAction/entry.ts');
  assert.match(src, /action === 'send_now' && \(await loadSettings\(base44\.asServiceRole\)\)\.dry_run !== false/);
  assert.match(src, /DRY_RUN/);
});

test('dry-run defaults to ON when the setting is missing', () => {
  assert.match(read('base44/shared/campaignRun.ts'), /dry_run/);
  assert.match(read('base44/entities/MessagingSettings.jsonc'), /"campaign_dry_run"[\s\S]*?"default": true/);
});