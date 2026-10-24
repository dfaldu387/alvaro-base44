/**
 * Route Flow (Scheduling Bot) — Control centre for automated scheduling.
 * Step 2: mode selector + basic Auto Placement configuration.
 * Renamed from "Scheduling Bot" to "Route Flow".
 */
import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';
import { cn } from '@/lib/utils';
import {
  Bot, Power, Layers, ShieldCheck, Gauge, ClipboardCheck, Loader2,
  Lock, CalendarClock, AlertCircle, ChevronDown, Check, Clock, Ruler,
  MapPin, AlertTriangle, History,
  RefreshCw, ChevronRight,
} from 'lucide-react';
import ReshuffleSuggestionCard from '@/components/routeflow/ReshuffleSuggestionCard';
import ReshufflePreviewModal from '@/components/routeflow/ReshufflePreviewModal';
import PlacementValidatorPanel from '@/components/routeflow/PlacementValidatorPanel';
import RouteFlowActivity from '@/components/routeflow/RouteFlowActivity';
import AdminPage from '@/components/admin/ui/AdminPage';
import StatusBadge from '@/components/admin/ui/StatusBadge';

const STATUS_LABELS = {
  off: 'Off',
  monitoring: 'Monitoring',
  'auto-placing': 'Auto-placing',
  optimising: 'Monitoring & Optimising',
};

const STATUS_COLORS = {
  off: 'bg-zinc-100 text-zinc-600',
  monitoring: 'bg-emerald-50 text-emerald-700',
  'auto-placing': 'bg-emerald-50 text-emerald-700',
  optimising: 'bg-emerald-50 text-emerald-700',
};

const MODE_OPTIONS = [
  {
    value: 'off',
    label: 'Off',
    description: 'Route Flow does not make scheduling changes.',
    available: true,
  },
  {
    value: 'auto_place',
    label: 'Auto-place only',
    description: 'New requests are automatically given a provisional calendar slot.',
    available: true,
  },
  {
    value: 'suggest',
    label: 'Suggest reshuffles',
    description: 'Route Flow automatically places new requests and looks for better ways to organise provisional appointments.',
    available: true,
  },
  {
    value: 'auto_optimise',
    label: 'Auto-optimise',
    description: 'Route Flow rearranges provisional appointments itself whenever a better day saves at least 10 minutes of driving and idle time.',
    available: true,
  },
];

const MODE_LABELS = {
  off: 'Off',
  auto_place: 'Auto-place only',
  suggest: 'Suggest reshuffles',
  auto_optimise: 'Auto-optimise',
};

const SECTION_DESCRIPTIONS = {
  placement: 'Controls how new booking requests are automatically placed into the calendar.',
  protection: 'Controls which appointments Route Flow is allowed to move.',
  optimisation: 'How Route Flow judges whether a day can be arranged better — driving time, idle time and keeping bookings scheduled.',
  review: 'Pending reshuffle suggestions for you to review, preview and apply.',
};

export default function SchedulingBot() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [evaluating, setEvaluating] = useState(false);
  const [busySuggestionId, setBusySuggestionId] = useState(null);
  const [previewSuggestion, setPreviewSuggestion] = useState(null);
  const [notice, setNotice] = useState(null);
  const [barbersMissingStart, setBarbersMissingStart] = useState([]);
  // Route Flow → Overview / Activity
  const [tab, setTab] = useState('overview');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const records = await base44.entities.SchedulingBotSettings.list('-created_date', 1);
      // No row yet is shown as the defaults; the first save creates the one row on the server.
      setSettings(records.length > 0 ? records[0] : { enabled: false, mode: 'off', auto_place_new_requests: true, status: 'off' });
    } catch {
      setSettings({ enabled: false, mode: 'off', auto_place_new_requests: true, status: 'off' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const loadSuggestions = useCallback(async () => {
    try {
      const rows = await base44.entities.RouteFlowSuggestion.filter({ status: 'pending' }, '-created_date', 20);
      setSuggestions(rows || []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  // A barber with no saved start location cannot have the first appointment of
  // their day auto-placed — surface them rather than failing silently.
  const loadBarbers = useCallback(async () => {
    try {
      const rows = await base44.entities.TeamMember.filter({ status: 'Active' }, '-created_date', 100);
      const list = Array.isArray(rows) ? rows : (rows?.items || []);
      setBarbersMissingStart(list
        .filter(m => !(typeof m.start_location_lat === 'number' && typeof m.start_location_lng === 'number'))
        .map(m => m.name)
        .filter(Boolean));
    } catch {
      setBarbersMissingStart([]);
    }
  }, []);

  useEffect(() => { loadBarbers(); }, [loadBarbers]);

  const updateSettings = useCallback(async (updates) => {
    setSaving(true);
    try {
      const updated = await saveSettings('SchedulingBotSettings', 'bot', updates);
      setSettings(updated);
    } catch {
      setSettings(prev => ({ ...prev, ...updates }));
    } finally {
      setSaving(false);
    }
  }, []);

  const enabled = settings?.enabled ?? false;
  const mode = settings?.mode ?? 'off';
  const autoPlaceNew = settings?.auto_place_new_requests ?? true;

  const statusForMode = (m) => (m === 'suggest' || m === 'auto_optimise' ? 'optimising' : m === 'auto_place' ? 'monitoring' : 'off');

  // Derived status — suggest mode places AND evaluates
  const status = !enabled ? 'off' : statusForMode(mode);

  const handleMasterToggle = () => {
    if (saving) return;
    const newEnabled = !enabled;
    const newMode = newEnabled ? (mode === 'off' ? 'auto_place' : mode) : 'off';
    updateSettings({
      enabled: newEnabled,
      mode: newMode,
      status: newEnabled ? statusForMode(newMode) : 'off',
    });
  };

  const handleModeSelect = (newMode) => {
    if (saving) return;
    setNotice(null);
    updateSettings({
      mode: newMode,
      enabled: newMode !== 'off',
      status: statusForMode(newMode),
    });
  };

  const handleAutoPlaceToggle = () => {
    if (saving) return;
    updateSettings({ auto_place_new_requests: !autoPlaceNew });
  };

  // Placement runs in every active mode; optimisation runs in suggest and auto_optimise
  const isAutoPlaceActive = enabled && (mode === 'auto_place' || mode === 'suggest' || mode === 'auto_optimise');
  const optimisationActive = enabled && (mode === 'suggest' || mode === 'auto_optimise');
  const autoOptimiseActive = enabled && mode === 'auto_optimise';

  const handleCheckNow = async () => {
    setEvaluating(true);
    setNotice(null);
    try {
      if (mode === 'auto_optimise') {
        // A dry run: report what Route Flow would change, without changing it.
        const res = await base44.functions.invoke('optimiseProvisionalDay', { dry_run: true });
        const results = res.data?.results || [];
        const best = results.reduce((max, r) => Math.max(max, r.improvement?.combined_saved || 0), 0);
        setNotice(best > 0
          ? `A better arrangement is available — worth ${best} minutes of driving and idle time.`
          : 'No better schedule found right now.');
      } else {
        const res = await base44.functions.invoke('routeFlowEvaluateReshuffleV2', {});
        await loadSuggestions();
        const found = (res.data?.results || []).filter(r => r.meaningful).length;
        setNotice(found > 0
          ? `${found} suggestion${found === 1 ? '' : 's'} found.`
          : 'No better schedule found right now.');
      }
    } catch {
      setNotice('Could not check for improvements.');
    } finally {
      setEvaluating(false);
    }
  };

  const handleDismissSuggestion = async (s) => {
    setBusySuggestionId(s.id);
    try {
      await base44.entities.RouteFlowSuggestion.update(s.id, { status: 'dismissed' });
      setSuggestions(prev => prev.filter(x => x.id !== s.id));
    } catch {
      /* ignore */
    } finally {
      setBusySuggestionId(null);
    }
  };

  const handleSuggestionApplied = (s) => {
    setPreviewSuggestion(null);
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
    setNotice('Changes applied. Provisional appointments were updated.');
  };

  return (
    <AdminPage
      title="Route Flow"
      subtitle="Intelligent scheduling and route optimisation"
      actions={
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Route Flow</p>
            <p className={cn('text-sm font-bold', enabled ? 'text-[#6366F1]' : 'text-zinc-400')}>
              {enabled ? 'ON' : 'OFF'}
            </p>
          </div>
          <button
            onClick={handleMasterToggle}
            disabled={loading || saving}
            aria-label="Turn Route Flow on or off"
            className={cn(
              'relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50',
              enabled ? 'bg-[#6366F1]' : 'bg-zinc-300'
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 text-white absolute top-1.5 left-3.5 animate-spin" />
            ) : (
              <span className={cn(
                'absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-sm transition-transform flex items-center justify-center',
                enabled && 'translate-x-5'
              )}>
                <Power className={cn('w-3 h-3', enabled ? 'text-[#6366F1]' : 'text-zinc-400')} />
              </span>
            )}
          </button>
        </div>
      }
    >
      {/* Navigation — Overview keeps every existing section; Activity is the log. */}
      <div className="border-b border-zinc-200">
        <div className="flex gap-1 max-w-5xl">
          {[
            { value: 'overview', label: 'Overview', icon: null },
            { value: 'activity', label: 'Activity', icon: History },
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors',
                tab === t.value ? 'border-[#6366F1] text-[#6366F1]' : 'border-transparent text-zinc-500 hover:text-zinc-800'
              )}
            >
              {t.icon && <t.icon className="w-3.5 h-3.5" />}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'activity' && <RouteFlowActivity />}

      {/* Content */}
      <div className={cn('space-y-5 max-w-5xl', tab !== 'overview' && 'hidden')}>
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 text-[#6366F1] animate-spin" />
          </div>
        ) : (
          <>
            {/* Status + Mode card */}
            <div className="bg-white border border-zinc-200 rounded-xl p-5">
              <div className="flex items-center gap-6 mb-5">
                {/* Status */}
                <div className="flex-1">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Status</p>
                  <span className={cn(
                    'inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full',
                    STATUS_COLORS[status] || STATUS_COLORS.off
                  )}>
                    <span className={cn(
                      'w-2 h-2 rounded-full',
                      status === 'off' ? 'bg-zinc-400' : 'bg-current animate-pulse'
                    )} />
                    {STATUS_LABELS[status] || 'Off'}
                  </span>
                </div>

                {/* Divider */}
                <div className="w-px h-12 bg-zinc-200" />

                {/* Mode */}
                <div className="flex-1">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Mode</p>
                  <span className="text-sm font-bold text-zinc-700">
                    {MODE_LABELS[mode] || 'Off'}
                  </span>
                </div>
              </div>

              {mode === 'suggest' && (
                <p className="text-xs text-zinc-500 -mt-2 mb-4">
                  Route Flow automatically places new requests and looks for better ways to organise provisional appointments.
                </p>
              )}

              {mode === 'auto_optimise' && (
                <p className="text-xs text-zinc-500 -mt-2 mb-4">
                  Route Flow places new requests, then rearranges provisional appointments itself whenever it saves at least 10 minutes of driving and idle time.
                </p>
              )}

              {/* Route Flow Mode selector */}
              <div className="border-t border-zinc-100 pt-4">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Route Flow Mode</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {MODE_OPTIONS.map(opt => {
                    const isSelected = mode === opt.value;
                    const isDisabled = !opt.available;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => !isDisabled && handleModeSelect(opt.value)}
                        disabled={isDisabled}
                        className={cn(
                          'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all',
                          isDisabled && 'opacity-50 cursor-not-allowed bg-zinc-50 border-zinc-100',
                          !isDisabled && isSelected && 'border-[#6366F1] bg-[#6366F1]/5 ring-1 ring-[#6366F1]/20',
                          !isDisabled && !isSelected && 'border-zinc-200 bg-white hover:border-zinc-300'
                        )}
                      >
                        <div className={cn(
                          'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                          isSelected ? 'bg-[#6366F1] border-[#6366F1]' : 'border-zinc-300'
                        )}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn('text-sm font-semibold', isSelected ? 'text-zinc-900' : 'text-zinc-700')}>
                            {opt.label}
                          </p>
                          <p className="text-xs text-zinc-500 mt-0.5">{opt.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {barbersMissingStart.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-amber-900">
                    Start location not configured — first-leg travel cannot be verified.
                  </p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                    {barbersMissingStart.join(', ')} {barbersMissingStart.length === 1 ? 'has' : 'have'} no saved start
                    location, so the first appointment of their day stays Unscheduled until one is added in
                    Team Members → Appointments.
                  </p>
                </div>
              </div>
            )}

            {/* Four section cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Placement — configurable */}
              <div className={cn(
                'md:col-span-2 bg-white border rounded-xl overflow-hidden transition-colors',
                isAutoPlaceActive ? 'border-[#6366F1]/30' : 'border-zinc-200'
              )}>
                <button
                  onClick={() => isAutoPlaceActive && setPlacementOpen(v => !v)}
                  disabled={!isAutoPlaceActive}
                  className={cn(
                    'w-full flex items-start gap-3 p-5 text-left',
                    isAutoPlaceActive && 'cursor-pointer hover:bg-zinc-50/50'
                  )}
                >
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                    isAutoPlaceActive ? 'bg-[#6366F1]/10' : 'bg-zinc-100'
                  )}>
                    <Layers className={cn('w-4.5 h-4.5', isAutoPlaceActive ? 'text-[#6366F1]' : 'text-zinc-500')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-zinc-900">Placement</h3>
                      {isAutoPlaceActive && (
                        <ChevronDown className={cn('w-4 h-4 text-zinc-400 transition-transform', placementOpen && 'rotate-180')} />
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed mt-1 mb-3">
                      {SECTION_DESCRIPTIONS.placement}
                    </p>
                    <span className={cn(
                      'inline-block text-xs font-semibold px-2.5 py-1 rounded-full',
                      isAutoPlaceActive ? 'bg-[#6366F1]/10 text-[#6366F1]' : 'bg-zinc-100 text-zinc-400'
                    )}>
                      {isAutoPlaceActive ? 'Auto-place enabled' : 'Not configured'}
                    </span>
                  </div>
                </button>

                {/* Placement settings panel */}
                {isAutoPlaceActive && placementOpen && (
                  <div className="border-t border-zinc-100 px-5 py-4 space-y-4 bg-zinc-50/30">
                    {/* Auto-place toggle */}
                    <div className="flex items-center justify-between">
                      <div className="flex-1 pr-3">
                        <p className="text-sm font-semibold text-zinc-700">Auto-place new requests</p>
                        <p className="text-xs text-zinc-500 mt-0.5">Automatically place eligible booking requests into the calendar.</p>
                      </div>
                      <button
                        onClick={handleAutoPlaceToggle}
                        disabled={saving}
                        className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0 disabled:opacity-50', autoPlaceNew ? 'bg-[#6366F1]' : 'bg-zinc-300')}
                      >
                        <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform', autoPlaceNew && 'translate-x-4')} />
                      </button>
                    </div>

                    <div className="border-t border-zinc-100" />

                    {/* Placement state */}
                    <FixedRule
                      icon={CalendarClock}
                      label="Placement state"
                      badge="Provisional"
                      badgeColor="indigo"
                      helper="New auto-placed bookings are set to Provisional — never Locked or Confirmed automatically."
                    />

                    <div className="border-t border-zinc-100" />

                    {/* Fixed rules */}
                    <FixedRule
                      icon={CalendarClock}
                      label="Customer availability"
                      badge="Required"
                      helper="Route Flow will only place the booking inside the customer's submitted availability window."
                    />
                    <FixedRule
                      icon={Lock}
                      label="Protected appointments"
                      badge="Respected"
                      helper="Locked and Confirmed appointments will never be moved or overlapped."
                    />
                    <FixedRule
                      icon={Ruler}
                      label="Scheduling increment"
                      badge="5 minutes"
                      helper="Route Flow may place appointments at 10:00, 10:05, 10:10, etc."
                    />
                    <FixedRule
                      icon={Clock}
                      label="Service duration"
                      badge="Must fit"
                      helper="The complete service duration must fit inside the availability window."
                    />
                    <FixedRule
                      icon={Clock}
                      label="Barber working hours"
                      badge="Normal only"
                      helper="Route Flow uses the barber's Normal Working Hours. Extended and After Hours are not used yet."
                    />
                    <FixedRule
                      icon={MapPin}
                      label="First-leg travel"
                      badge="Start location"
                      helper="Each barber's day begins at the start location saved on their own Team Member profile — real road travel is measured from there to the first appointment. No business-wide start location is used."
                    />
                    <FixedRule
                      icon={AlertCircle}
                      label="When no valid slot is available"
                      badge="Leave Unscheduled"
                      helper="The request will remain available for manual scheduling."
                    />
                  </div>
                )}

                {/* Validate a placement — always available, so a proposed slot can be
                    checked against the live calendar even while Route Flow is off.
                    It runs the same backend engine Route Flow and the calendar use. */}
                <div className="border-t border-zinc-100 px-5 py-4 bg-zinc-50/30">
                  <PlacementValidatorPanel />
                </div>
              </div>

              {/* Protection — always active (system rule) */}
              <div className="bg-white border border-emerald-500/30 rounded-xl p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4.5 h-4.5 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-zinc-900">Protection</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed mt-1">{SECTION_DESCRIPTIONS.protection}</p>
                  </div>
                </div>

                <div className="mb-4">
                  <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600">
                    Protection active
                  </span>
                  <p className="text-xs text-zinc-500 mt-2">Locked and Confirmed appointments are protected from Route Flow.</p>
                </div>

                <div className="space-y-0 border-t border-zinc-100 pt-2">
                  <ProtectionState label="Provisional appointments" badge="Movable" badgeColor="indigo" />
                  <ProtectionState label="Locked appointments" badge="Protected" badgeColor="emerald" />
                  <ProtectionState label="Confirmed appointments" badge="Protected" badgeColor="emerald" />
                  <ProtectionState label="Availability overrides" badge="Admin only" badgeColor="amber" />
                </div>
              </div>

              {/* Optimisation */}
              <div className={cn(
                'bg-white border rounded-xl p-5',
                optimisationActive ? 'border-[#6366F1]/30' : 'border-zinc-200'
              )}>
                <div className="flex items-start gap-3 mb-3">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    optimisationActive ? 'bg-[#6366F1]/10' : 'bg-zinc-100'
                  )}>
                    <Gauge className={cn('w-4.5 h-4.5', optimisationActive ? 'text-[#6366F1]' : 'text-zinc-500')} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-zinc-900">Optimisation</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed mt-1">{SECTION_DESCRIPTIONS.optimisation}</p>
                  </div>
                </div>

                {optimisationActive ? (
                  <>
                    <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-[#6366F1]/10 text-[#6366F1]">
                      {autoOptimiseActive ? 'Auto-optimise active' : 'Suggest reshuffles active'}
                    </span>
                    <div className="mt-4 space-y-0 border-t border-zinc-100 pt-2">
                      <ProtectionState label="Keep valid bookings scheduled" badge="Primary" badgeColor="indigo" />
                      <ProtectionState label="Minimise idle time" badge="Tracked" badgeColor="indigo" />
                      <ProtectionState label="Minimise driving time" badge="Tracked" badgeColor="indigo" />
                    </div>
                    <p className="text-xs text-zinc-500 mt-3">
                      {autoOptimiseActive
                        ? 'Route Flow rearranges Provisional appointments itself once a better day saves at least 10 minutes of driving and idle time combined. Locked and Confirmed appointments stay fixed, no booking is ever dropped, and every proposed time is re-checked against the live calendar before it is applied.'
                        : 'Route Flow only surfaces a suggestion when it saves at least 10 minutes of driving, 15 minutes of idle time, or fits an extra booking. Travel is calculated in the background — no drive blocks are created.'}
                    </p>
                  </>
                ) : (
                  <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-400">Not configured</span>
                )}
              </div>

              {/* Review & Control */}
              <div className={cn(
                'bg-white border rounded-xl p-5',
                optimisationActive ? 'border-[#6366F1]/30' : 'border-zinc-200'
              )}>
                <div className="flex items-start gap-3 mb-3">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    optimisationActive ? 'bg-[#6366F1]/10' : 'bg-zinc-100'
                  )}>
                    <ClipboardCheck className={cn('w-4.5 h-4.5', optimisationActive ? 'text-[#6366F1]' : 'text-zinc-500')} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-zinc-900">Review &amp; Control</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed mt-1">{SECTION_DESCRIPTIONS.review}</p>
                  </div>
                  {optimisationActive && (
                    <button
                      onClick={handleCheckNow}
                      disabled={evaluating}
                      className="flex items-center gap-1.5 text-xs font-semibold text-[#6366F1] border border-[#6366F1]/30 bg-[#6366F1]/5 hover:bg-[#6366F1]/10 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                    >
                      <RefreshCw className={cn('w-3.5 h-3.5', evaluating && 'animate-spin')} /> Check now
                    </button>
                  )}
                </div>

                {!optimisationActive ? (
                  <div className="space-y-2">
                    <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-400">Not configured</span>
                    <p className="text-xs text-zinc-500">
                      Select <span className="font-semibold text-zinc-600">Suggest reshuffles</span> or <span className="font-semibold text-zinc-600">Auto-optimise</span> to let Route Flow look for better ways to organise provisional appointments.
                    </p>
                  </div>
                ) : autoOptimiseActive ? (
                  <div className="space-y-2">
                    <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600">Applying automatically</span>
                    <p className="text-xs text-zinc-500">
                      Route Flow applies a better arrangement on its own as soon as one is worth at least 10 minutes. Every optimisation is recorded in Activity below.
                    </p>
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-6 text-center">
                    <p className="text-xs font-semibold text-zinc-500">No suggestions</p>
                    <p className="text-xs text-zinc-400 mt-1">Route Flow will suggest changes when a meaningfully better day is available.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {suggestions.map(s => (
                      <ReshuffleSuggestionCard
                        key={s.id}
                        suggestion={s}
                        onReview={setPreviewSuggestion}
                        onDismiss={handleDismissSuggestion}
                        busy={busySuggestionId === s.id}
                      />
                    ))}
                  </div>
                )}

                {notice && <p className="text-xs text-zinc-500 mt-3">{notice}</p>}
              </div>
            </div>

            {/* Activity has its own tab — this is the way in. */}
            <div className="bg-white border border-zinc-200 rounded-xl p-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#6366F1]/10 flex items-center justify-center shrink-0">
                  <History className="w-4.5 h-4.5 text-[#6366F1]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-zinc-900">Activity</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed mt-1">
                    Every placement, reshuffle and request Route Flow could not place, with the reason
                    behind it — including everything that happened while this page was closed.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTab('activity')}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#6366F1] border border-[#6366F1]/30 bg-[#6366F1]/5 hover:bg-[#6366F1]/10 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
              >
                View activity <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {previewSuggestion && (
        <ReshufflePreviewModal
          suggestion={previewSuggestion}
          onClose={() => setPreviewSuggestion(null)}
          onApplied={handleSuggestionApplied}
        />
      )}
    </AdminPage>
  );
}

function ProtectionState({ label, badge, badgeColor }) {
  const colors = {
    indigo: 'text-indigo-600 bg-indigo-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
  };
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-zinc-600">{label}</span>
      <StatusBadge tone={badgeColor === 'amber' ? 'warning' : badgeColor === 'emerald' ? 'success' : 'neutral'}>{badge}</StatusBadge>
    </div>
  );
}

function FixedRule({ icon: Icon, label, badge, badgeColor, helper }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-zinc-500" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-zinc-700">{label}</p>
          <StatusBadge tone={badgeColor === 'indigo' ? 'success' : 'neutral'}>{badge}</StatusBadge>
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">{helper}</p>
      </div>
    </div>
  );
}