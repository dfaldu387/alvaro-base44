/**
 * Two-approver rule for turning campaign dry-run OFF. Pure decisions only; the
 * setCampaignDryRun function does the reads and writes.
 *   1. An admin requests it (typed phrase + a recorded dry-run preview for BOTH stages this week).
 *   2. A DIFFERENT authenticated admin approves it while the request is unexpired
 *      and the preview is still the one that was reviewed.
 *   3. The change is applied only if its audit record is written.
 */
export const OFF_PHRASE = 'TURN OFF DRY RUN';
export const APPROVAL_TTL_HOURS = 24;

export type Check = { ok: true } | { ok: false; code: string; message: string };
const no = (code: string, message: string): Check => ({ ok: false, code, message });

/** Both stages need a completed dry-run for the current week. */
export function previewRecorded(latest: { outreach?: any; followup?: any }): Check {
  const missing = (['outreach', 'followup'] as const).filter(s => !latest?.[s] || latest[s].status !== 'complete' || latest[s].mode !== 'dry_run');
  return missing.length === 0 ? { ok: true } : no('PREVIEW_REQUIRED', `Run a dry-run preview for ${missing.join(' and ')} this week first. It must be recorded before dry-run can be turned off.`);
}

export const previewIds = (latest: { outreach?: any; followup?: any }): string[] => [latest?.outreach?.id, latest?.followup?.id].filter(Boolean);

export const isExpired = (approval: any, now: Date = new Date()): boolean =>
  !approval?.expires_at || new Date(approval.expires_at).getTime() <= now.getTime();

/** Same person = same user id, or (when an id is missing) the same email. Unknown identity never counts as different. */
export function samePerson(a: { id?: string | null; email?: string | null }, b: { id?: string | null; email?: string | null }): boolean {
  if (a.id && b.id) return a.id === b.id;
  if (a.email && b.email) return a.email.toLowerCase() === b.email.toLowerCase();
  return true;
}

export function checkApproval(approval: any, approver: { id?: string | null; email?: string | null }, latest: { outreach?: any; followup?: any }, now: Date = new Date()): Check {
  if (!approval) return no('NO_REQUEST', 'There is no request to approve.');
  if (approval.status !== 'pending') return no('NOT_PENDING', 'This request is no longer waiting for approval.');
  if (isExpired(approval, now)) return no('EXPIRED', 'This request has expired. Ask for a new one.');
  if (!approver.id && !approver.email) return no('IDENTITY_REQUIRED', 'Your identity could not be verified.');
  if (samePerson({ id: approval.requested_by_id, email: approval.requested_by_email }, approver)) {
    return no('SAME_APPROVER', 'A second, different admin must approve. You cannot approve your own request.');
  }
  const current = previewIds(latest).sort().join(',');
  const reviewed = [...(approval.preview_run_ids || [])].sort().join(',');
  if (!current || current !== reviewed) return no('PREVIEW_CHANGED', 'The preview changed after this request was made. Review the current preview and request again.');
  return { ok: true };
}