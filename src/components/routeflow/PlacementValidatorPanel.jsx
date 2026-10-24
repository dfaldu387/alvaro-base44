import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';
import { validatePlacement, VIOLATION_CODES } from '@/lib/placementValidation';
import { decimalToLabel } from '@/lib/timeUtils';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, FlaskConical } from 'lucide-react';

/**
 * Route Flow → Placement → Validate a placement.
 * Admin testing/debugging surface for the Category 1 hard-constraint engine.
 * It calls the same backend validator Route Flow and the calendar use, so what
 * is shown here is exactly the decision the automation would make.
 */
export default function PlacementValidatorPanel() {
  const [requests, setRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [requestId, setRequestId] = useState('');
  const [barberId, setBarberId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('11:00');
  const [source, setSource] = useState('route_flow');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    base44.entities.BookingRequest.filter({ schedule_status: 'unscheduled' }, '-created_date', 30)
      .then(res => setRequests(res?.items || []))
      .catch(() => setRequests([]));
    base44.entities.TeamMember.filter({ status: 'Active' }, 'name', 30)
      .then(res => setMembers((res?.items || []).filter(m => m.is_bookable !== false)))
      .catch(() => setMembers([]));
  }, []);

  const handleRequestChange = useCallback((id) => {
    setRequestId(id);
    setResult(null);
    setError(null);
    const req = requests.find(r => r.id === id);
    if (req?.requested_date) setDate(req.requested_date);
    if (req?.team_member_id) setBarberId(req.team_member_id);
  }, [requests]);

  const run = useCallback(async () => {
    if (!requestId) { setError('Choose a booking request to test.'); return; }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await validatePlacement({
        requestId,
        startDecimal: time,
        date: date || undefined,
        barberId: barberId || undefined,
        // log: the checked decision is recorded in the placement audit trail.
        options: { source, log: true },
      });
      if (!data || data.error) {
        setError(data?.error || 'The validator did not return a result.');
      } else {
        setResult(data);
      }
    } catch (e) {
      setError('Could not run the validator. Please try again.');
    } finally {
      setRunning(false);
    }
  }, [requestId, time, date, barberId, source]);

  const passed = (result?.checks || []).filter(c => c.passed);
  const failed = (result?.checks || []).filter(c => !c.passed);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#6366F1]/10 flex items-center justify-center shrink-0">
          <FlaskConical className="w-4 h-4 text-[#6366F1]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-800">Validate a placement</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Runs the hard-constraint engine on a real request — the same rules Route Flow applies before it places anything.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <label className="block">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Request</span>
          <select
            value={requestId}
            onChange={e => handleRequestChange(e.target.value)}
            className="mt-1 w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-[#6366F1]/40"
          >
            <option value="">Select an unscheduled request…</option>
            {requests.map(r => (
              <option key={r.id} value={r.id}>
                {r.client_name} — {r.requested_date || r.day} {r.availability_window ? `(${r.availability_window})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Barber</span>
          <select
            value={barberId}
            onChange={e => { setBarberId(e.target.value); setResult(null); }}
            className="mt-1 w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-[#6366F1]/40"
          >
            <option value="">From the request</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Date</span>
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); setResult(null); }}
            className="mt-1 w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-[#6366F1]/40"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Proposed start</span>
          <input
            type="time"
            step="300"
            value={time}
            onChange={e => { setTime(e.target.value); setResult(null); }}
            className="mt-1 w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-[#6366F1]/40"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5">
          {[{ v: 'route_flow', l: 'Route Flow' }, { v: 'manual', l: 'Manual' }].map(opt => (
            <button
              key={opt.v}
              onClick={() => { setSource(opt.v); setResult(null); }}
              className={cn(
                'text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors',
                source === opt.v ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500'
              )}
            >
              {opt.l}
            </button>
          ))}
        </div>
        <button
          onClick={run}
          disabled={running || !requestId}
          className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#6366F1] hover:bg-[#6366F1]/90 px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          Validate
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className={cn(
              'inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full',
              result.valid ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
            )}>
              {result.valid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {result.valid ? 'Valid placement' : 'Invalid placement'}
            </span>
            <span className="text-xs font-semibold text-zinc-600">
              {result.proposed_start}{result.proposed_end ? ` – ${result.proposed_end}` : ''}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span>Calendar time: <span className="font-semibold text-zinc-700">{result.calendar_minutes} min</span></span>
            <span>Coverage: <span className="font-semibold text-zinc-700">{result.coverage?.tier || '—'}</span></span>
            <span>Working hours: <span className="font-semibold text-zinc-700">{result.working_hours?.eligibility || '—'}</span></span>
            <span>Travel: <span className="font-semibold text-zinc-700">{result.travel?.verified ? 'verified (road)' : 'unverified'}</span></span>
          </div>

          {/* How the time is actually built, with nothing hidden in it:
              service end → configured buffer → required travel → next legal start.
              Admin diagnostics only — normal users never see this. */}
          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1.5">
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">Timing breakdown</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              <span>Service ends: <span className="font-semibold text-zinc-700">{clockLabel(result.timing?.service_end)}</span></span>
              <span>Buffer ends: <span className="font-semibold text-zinc-700">{clockLabel(result.timing?.buffer_end)}</span></span>
              <span>Travel before: <span className="font-semibold text-zinc-700">{result.travel?.previous?.required_mins != null ? `${result.travel.previous.required_mins} min` : '—'}</span></span>
              <span>Earliest next start: <span className="font-semibold text-[#6366F1]">{clockLabel(result.timing?.earliest_next_start)}</span></span>
            </div>
            <p className="text-[10px] text-zinc-400">
              Service {result.timing?.service_minutes ?? result.service_minutes} min + configured buffer {result.timing?.buffer_minutes ?? result.buffer_minutes} min
              {result.timing?.step_minutes ? ` · ${result.timing.step_minutes}-minute increments` : ''}
            </p>
          </div>

          {failed.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-red-600 uppercase tracking-wide">Failed checks</p>
              {failed.map(c => (
                <div key={c.code} className="flex items-start gap-2">
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-700">
                      {VIOLATION_CODES[c.code] || c.label}
                      <span className="ml-1.5 text-[10px] font-mono text-zinc-400">{c.code}</span>
                    </p>
                    {c.message && <p className="text-[11px] text-zinc-500">{c.message}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">Passed checks</p>
            <div className="flex flex-wrap gap-1.5">
              {passed.map(c => (
                <span key={c.code} className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" />{VIOLATION_CODES[c.code] || c.label}
                </span>
              ))}
            </div>
          </div>

          {(result.warnings || []).length > 0 && (
            <div className="space-y-1">
              {(result.warnings || []).map(w => (
                <p key={w.code} className="flex items-start gap-1.5 text-[11px] text-amber-600">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w.message}
                </p>
              ))}
            </div>
          )}

          <p className="text-[10px] text-zinc-400">
            Validated against the live schedule — re-run before relying on this result.
          </p>
        </div>
      )}
    </div>
  );
}

/** Decimal hour → "10:05am"; null-safe for diagnostics with no value. */
function clockLabel(dec) {
  if (dec == null || !isFinite(Number(dec))) return '—';
  return decimalToLabel(Number(dec));
}