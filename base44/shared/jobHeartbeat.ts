/**
 * Proof that a scheduled job is alive. Each scheduled run writes ONE row per job
 * (upserted by job_key), so an hourly job that correctly does nothing is visible
 * on the Automation page without filling any table with noise.
 *
 * A failure to write the heartbeat never breaks the job itself.
 */
export type JobKey = 'sweep' | 'arrival' | 'campaign' | 'autoplace' | 'reshuffle';

export interface JobRun {
  outcome: 'acted' | 'no_op' | 'failed';
  reason?: string;
  detail?: string;
  processed?: number;
  sent?: number;
  suppressed?: number;
  failed?: number;
  error?: string | null;
}

export async function recordJobRun(admin: any, key: JobKey, run: JobRun): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    await admin.entities.JobHeartbeat.upsert([{
      job_key: key,
      last_run_at: now,
      last_outcome: run.outcome,
      last_reason: (run.reason || '').slice(0, 300),
      last_detail: (run.detail || '').slice(0, 300),
      processed: run.processed ?? 0,
      sent: run.sent ?? 0,
      suppressed: run.suppressed ?? 0,
      failed: run.failed ?? 0,
      last_error: (run.error || '').slice(0, 300),
      ...(run.outcome === 'acted' ? { last_acted_at: now } : {}),
    }], { key: 'job_key' });
    return true;
  } catch (e) {
    console.error('[jobHeartbeat] write failed', key, (e as Error)?.message);
    return false;
  }
}

/**
 * The two Route Flow workflows are triggered by a booking changing, not by a clock.
 * `runFromResponse` turns the function's own answer into the heartbeat for that run;
 * `withHeartbeat` records it, but only for a call that came from the workflow runner
 * and got past the authority gate (a refused call is not a run).
 */
export function runFromResponse(status: number, body: any): JobRun | null {
  if (status === 401 || status === 403) return null;
  const text = (v: unknown) => String(v ?? '').replace(/_/g, ' ');
  if (status >= 400 || (body && body.error)) {
    return { outcome: 'failed', error: String(body?.error || `Failed with status ${status}`), failed: 1 };
  }
  if (body?.skipped === true) return { outcome: 'no_op', reason: text(body.reason) || 'Skipped.', processed: 1, suppressed: 1 };
  if (typeof body?.evaluated === 'number' && body.evaluated === 0) return { outcome: 'no_op', reason: 'Nothing to evaluate.', processed: 0 };
  const n = typeof body?.evaluated === 'number' ? body.evaluated : 1;
  return { outcome: 'acted', processed: n, sent: Number(body?.applied) || 0, detail: body?.summary ? String(body.summary) : undefined };
}

export async function withHeartbeat(
  req: Request, key: JobKey, handle: (r: Request) => Promise<Response>, adminFor: (r: Request) => any,
  opts: { ignoreSkipped?: boolean } = {},
): Promise<Response> {
  const res = await handle(req);
  try {
    if (req.headers.get('x-workflow-run')) {
      const body = await res.clone().json().catch(() => ({}));
      const run = runFromResponse(res.status, body);
      // A step that is switched off by design must not overwrite the step that did the work.
      if (run && !(opts.ignoreSkipped && body?.skipped === true)) await recordJobRun(adminFor(req), key, run);
    }
  } catch (e) {
    console.error('[jobHeartbeat] could not record the run', key, (e as Error)?.message);
  }
  return res;
}