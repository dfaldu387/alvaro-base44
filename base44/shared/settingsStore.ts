/**
 * Business settings: ONE row per settings entity, written only by the server.
 *
 * Why this exists: each admin screen used to read "the" row and, finding none (or losing a
 * race), create its own. Two screens created two rows, the readers picked a different one
 * from the screens, and a create that echoed back a partial copy blanked the fields another
 * screen owned (which is how the daily booking cap fell back to 8).
 *
 * Rules built in:
 *  - A save writes ONLY the fields its screen owns (SETTINGS[entity].screens). Anything else
 *    is refused, so a screen can never blank a field group it does not own.
 *  - Exactly one row. The row is read and updated; it is created only when there is none. If
 *    two creates race, the newer is deleted and the oldest wins (same idea as publicBookingCreate).
 *  - Existing extra rows are healed into the oldest one: per field the newest SET value wins,
 *    a blank never overwrites a set value, the extras are deleted, one audit row says what merged.
 *  - Every change is audited (who, which fields) BEFORE it is written; no record, no change.
 *  - Reads use the same merged view (readSettings), so every caller sees the one record.
 */
import { recordAudit, finishAudit, AUDIT_REFUSED } from './auditLog.ts';

type Kind = 'number' | 'boolean' | 'string' | 'array' | string[];

interface Def {
  label: string;
  /** Per-barber rows (team_member_id set) are separate records and are never part of the one business row. */
  businessRowOnly?: boolean;
  fields: Record<string, Kind>;
  screens: Record<string, { label: string; fields: string[] }>;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIXED_PCT = ['fixed', 'percentage'];

export const SETTINGS: Record<string, Def> = {
  GroupDiscountSettings: {
    label: 'Group discounts, capacity and coverage',
    businessRowOnly: true,
    fields: {
      enabled: 'boolean', max_group_booking_people: 'number', max_bookings_per_day: 'number',
      service_centre_lat: 'number', service_centre_lng: 'number', service_centre_address: 'string',
      core_radius_km: 'number', extended_radius_km: 'number', maximum_service_radius_km: 'number',
      tier_2_type: FIXED_PCT, tier_2_amount: 'number', tier_3_type: FIXED_PCT, tier_3_amount: 'number',
      tier_4plus_type: FIXED_PCT, tier_4plus_amount: 'number',
    },
    screens: {
      discounts: { label: 'Group Discounts', fields: ['enabled', 'max_group_booking_people', 'tier_2_type', 'tier_2_amount', 'tier_3_type', 'tier_3_amount', 'tier_4plus_type', 'tier_4plus_amount'] },
      availability: { label: 'Booking Availability', fields: ['max_bookings_per_day'] },
      coverage: { label: 'Service Coverage', fields: ['service_centre_lat', 'service_centre_lng', 'service_centre_address', 'core_radius_km', 'extended_radius_km', 'maximum_service_radius_km'] },
    },
  },
  BookingRules: {
    label: 'Booking rules',
    fields: {
      minimum_notice_hours: 'number', maximum_booking_days: 'number', auto_accept_requests: 'boolean',
      allow_multiple_services: 'boolean', max_services_per_booking: 'number', default_buffer_minutes: 'number',
      appointment_interval_minutes: 'number', booking_cutoff_hour: 'number', min_availability_window_hours: 'number',
      max_availability_window_hours: 'number', service_must_fit_window: 'boolean', buffer_can_extend_past_window: 'boolean',
      core_service_areas: 'string', out_of_area_after_3pm: 'boolean', cancellation_policy: 'string',
      allow_client_reschedule: 'boolean', client_reschedule_needs_approval: 'boolean',
    },
    screens: {
      window: { label: 'Booking Window', fields: ['minimum_notice_hours', 'maximum_booking_days'] },
      rules: {
        label: 'Booking Rules',
        fields: ['auto_accept_requests', 'allow_multiple_services', 'max_services_per_booking', 'default_buffer_minutes', 'appointment_interval_minutes',
          'booking_cutoff_hour', 'min_availability_window_hours', 'max_availability_window_hours', 'service_must_fit_window',
          'buffer_can_extend_past_window', 'core_service_areas', 'out_of_area_after_3pm', 'cancellation_policy',
          'allow_client_reschedule', 'client_reschedule_needs_approval'],
      },
    },
  },
  DepositRules: {
    label: 'Deposit rules',
    fields: {
      enabled: 'boolean', deposit_type: FIXED_PCT, deposit_amount: 'number', require_for_new_clients: 'boolean',
      min_no_shows: 'number', min_booking_value: 'number', group_min_people: 'number', new_client_deposit_amount: 'number',
      after_hours_deposit_amount: 'number', no_show_deposit_amount: 'number', link_expiry_hours: 'number', allow_waive: 'boolean',
    },
    screens: {
      deposits: {
        label: 'Deposit Rules',
        fields: ['enabled', 'deposit_type', 'deposit_amount', 'require_for_new_clients', 'min_no_shows', 'min_booking_value', 'group_min_people',
          'new_client_deposit_amount', 'after_hours_deposit_amount', 'no_show_deposit_amount', 'link_expiry_hours', 'allow_waive'],
      },
    },
  },
  MessagingSettings: {
    label: 'Messaging settings',
    // The mode, allowlist, dry-run and assistant switches are changed only by their own audited
    // functions. This entity's screen here owns the campaign schedule and nothing else.
    fields: {
      messaging_mode: ['off', 'allowlist', 'live'], allowlist_numbers: 'array', went_live_at: 'string', went_live_by: 'string',
      arrival_send_hour: 'number', campaign_outreach_day: DAYS, campaign_followup_day: DAYS, campaign_run_hour: 'number',
      campaign_timezone: 'string', campaign_max_per_run: 'number', campaign_dry_run: 'boolean', campaign_max_overdue_days: 'number',
      campaign_booking_link: 'string', assistant_mode: ['off', 'draft', 'live'],
    },
    screens: {
      campaign: { label: 'Campaign settings', fields: ['campaign_outreach_day', 'campaign_followup_day', 'campaign_run_hour', 'campaign_timezone', 'campaign_max_per_run', 'campaign_max_overdue_days', 'campaign_booking_link'] },
    },
  },
  SchedulingSettings: {
    label: 'Appointment protection',
    fields: { auto_lock_confirmed: 'boolean', allow_manual_move_locked: 'boolean', allow_manual_move_confirmed: 'boolean' },
    screens: { protection: { label: 'Appointment Protection', fields: ['auto_lock_confirmed', 'allow_manual_move_locked', 'allow_manual_move_confirmed'] } },
  },
  SchedulingBotSettings: {
    label: 'Scheduling bot',
    fields: { enabled: 'boolean', mode: ['off', 'auto_place', 'suggest', 'auto_optimise'], auto_place_new_requests: 'boolean', status: ['off', 'monitoring', 'auto-placing', 'optimising'] },
    screens: { bot: { label: 'Scheduling Bot', fields: ['enabled', 'mode', 'auto_place_new_requests', 'status'] } },
  },
  BookingProtectionRules: {
    label: 'Booking protection limits',
    fields: {
      enabled: 'boolean', max_per_phone_hour: 'number', max_per_email_hour: 'number', max_per_ip_hour: 'number',
      max_active_unconfirmed: 'number', max_names_per_phone_day: 'number', flag_outer_tier: 'boolean',
      repeat_declined_hours: 'number', late_cancel_hours: 'number',
    },
    screens: {
      limits: {
        label: 'Protection limits',
        fields: ['enabled', 'max_per_phone_hour', 'max_per_email_hour', 'max_per_ip_hour', 'max_active_unconfirmed', 'max_names_per_phone_day',
          'flag_outer_tier', 'repeat_declined_hours', 'late_cancel_hours'],
      },
    },
  },
};

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const isSet = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const createdKey = (r: any) => String(r?.created_date || '');
/** Oldest first; the id breaks a tie so every caller picks the same winner. */
const byAge = (a: any, b: any) => createdKey(a).localeCompare(createdKey(b)) || String(a.id).localeCompare(String(b.id));
const touchedKey = (r: any) => String(r?.updated_date || r?.created_date || '');

function defOf(entity: string): Def {
  const def = SETTINGS[entity];
  if (!def) throw new Error(`unknown settings entity ${entity}`);
  return def;
}

/** Every row that counts as the one record, oldest first. */
async function candidates(admin: any, entity: string): Promise<any[]> {
  const def = defOf(entity);
  const rows = asList(await admin.entities[entity].list('created_date', 200));
  return rows.filter((r) => !def.businessRowOnly || !r.team_member_id).sort(byAge);
}

export interface Reconciled {
  /** The oldest row: the one that is kept. Null when there is none. */
  keep: any | null;
  extras: any[];
  /** The kept row's fields with every set value from the extras folded in (newest set value wins). */
  view: any | null;
  /** Only the fields that must be written to the kept row to make it equal the view. */
  patch: Record<string, unknown>;
}

/** Pure: how a set of rows reconciles into the oldest one. A blank never overwrites a set value. */
export function reconcile(entity: string, rows: any[]): Reconciled {
  const def = defOf(entity);
  const sorted = [...rows].sort(byAge);
  const keep = sorted[0] || null;
  if (!keep) return { keep: null, extras: [], view: null, patch: {} };
  const extras = sorted.slice(1);
  const newestFirst = [...sorted].sort((a, b) => touchedKey(b).localeCompare(touchedKey(a)) || byAge(b, a));
  const patch: Record<string, unknown> = {};
  for (const field of Object.keys(def.fields)) {
    const winner = newestFirst.find((r) => isSet(r[field]));
    if (winner && !same(winner[field], keep[field])) patch[field] = winner[field];
  }
  return { keep, extras, view: { ...keep, ...patch }, patch };
}

/** The one record for readers (same answer for every caller, even before a save has healed duplicates). */
export async function readSettings(admin: any, entity: string): Promise<any | null> {
  return reconcile(entity, await candidates(admin, entity)).view;
}

/** The same record as a list of zero or one, for callers that were written against `.list()`. */
export async function readSettingsList(admin: any, entity: string): Promise<any[]> {
  const row = await readSettings(admin, entity);
  return row ? [row] : [];
}

/**
 * The one row, created only when there is genuinely none. A create that loses a race deletes
 * itself and returns the winner, so concurrent first saves can never leave two rows.
 */
export async function ensureSettingsRow(admin: any, entity: string, initial: Record<string, unknown> = {}): Promise<any> {
  const existing = reconcile(entity, await candidates(admin, entity));
  if (existing.view) return existing.view;
  const mine = await admin.entities[entity].create({ ...initial });
  const after = reconcile(entity, await candidates(admin, entity));
  if (after.keep && after.keep.id !== mine.id) {
    try { await admin.entities[entity].delete(mine.id); } catch { /* the winner is still the one record */ }
    return after.view;
  }
  return after.view || mine;
}

function checkValue(field: string, kind: Kind, v: unknown): string | null {
  if (v === null) return kind === 'number' || kind === 'string' ? null : `${field} cannot be empty`;
  if (Array.isArray(kind)) return kind.includes(v as string) ? null : `${field} must be one of ${kind.join(', ')}`;
  if (kind === 'number') return typeof v === 'number' && Number.isFinite(v) ? null : `${field} must be a number`;
  if (kind === 'boolean') return typeof v === 'boolean' ? null : `${field} must be true or false`;
  if (kind === 'string') return typeof v === 'string' && v.length <= 4000 ? null : `${field} must be text`;
  return Array.isArray(v) ? null : `${field} must be a list`;
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => ({ status, body: { success: false, error, ...extra } });

/** Validates a screen's save: known entity and screen, only fields the screen owns, right types. */
export function validateSave(entity: string, screen: string, data: unknown): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const def = SETTINGS[entity];
  if (!def) return { ok: false, error: 'Unknown settings.' };
  const owned = def.screens[screen];
  if (!owned) return { ok: false, error: 'Unknown settings screen.' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Nothing to save.' };
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (!owned.fields.includes(field)) return { ok: false, error: `${owned.label} cannot change "${field}".` };
    const problem = checkValue(field, def.fields[field], value);
    if (problem) return { ok: false, error: problem[0].toUpperCase() + problem.slice(1) + '.' };
    patch[field] = value;
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'Nothing to save.' };
  return { ok: true, patch };
}

/**
 * Saves one screen's fields into the one settings row. Admin-only is the caller's job
 * (the function checks it before this runs). Returns { status?, body }.
 */
export async function saveSettings(admin: any, opts: { entity: string; screen: string; data: unknown; who: string }): Promise<{ status?: number; body: any }> {
  const checked = validateSave(opts.entity, opts.screen, opts.data);
  if (!checked.ok) return fail(400, checked.error);
  const def = defOf(opts.entity);
  const label = def.screens[opts.screen].label;
  const table = admin.entities[opts.entity];

  // 1. Heal any damage first: fold extra rows into the oldest, with a record of exactly what merged.
  let healed = 0;
  let rec = reconcile(opts.entity, await candidates(admin, opts.entity));
  if (rec.keep && rec.extras.length) {
    const fields = Object.keys(rec.patch);
    const auditId = await recordAudit(admin, {
      action: 'settings_merged', who: opts.who,
      summary: `Merged ${rec.extras.length + 1} copies of ${def.label} into one`,
      note: fields.length ? `Fields kept from newer copies: ${fields.join(', ')}` : 'No field differed',
      counts: { rows_merged: rec.extras.length + 1, fields_updated: fields.length, rows_deleted: rec.extras.length },
      ids: { kept_id: rec.keep.id },
    });
    if (!auditId) return { status: 500, body: { success: false, ...AUDIT_REFUSED } };
    if (fields.length) await table.update(rec.keep.id, rec.patch);
    for (const extra of rec.extras) await table.delete(extra.id);
    healed = rec.extras.length;
    rec = { keep: { ...rec.keep, ...rec.patch }, extras: [], view: rec.view, patch: {} };
  }

  // 2. Only the fields that actually change are written and audited.
  const current = rec.view;
  const patch = Object.fromEntries(Object.entries(checked.patch).filter(([k, v]) => !current || !same(current[k], v)));
  const changed = Object.keys(patch);
  if (!changed.length) return { body: { success: true, row: current, changed: [], healed } };

  const entry = {
    action: 'settings_changed', who: opts.who,
    summary: `Changed ${label}: ${changed.join(', ')}`,
    counts: { fields_changed: changed.length },
    ids: { settings_id: current?.id },
  };
  const auditId = await recordAudit(admin, entry);
  if (!auditId) return { status: 500, body: { success: false, ...AUDIT_REFUSED } };

  try {
    let row: any;
    if (current) {
      row = { ...current, ...(await table.update(current.id, patch)) };
    } else {
      // Created with this screen's fields only, so no other screen's fields are ever blanked.
      const mine = await table.create({ ...patch });
      const after = reconcile(opts.entity, await candidates(admin, opts.entity));
      if (after.keep && after.keep.id !== mine.id) {
        // Lost the race: the winner is the one row; this screen's fields go onto it.
        try { await table.delete(mine.id); } catch { /* winner stays the one record */ }
        row = { ...after.view, ...(await table.update(after.keep.id, patch)) };
      } else row = { ...mine };
    }
    return { body: { success: true, row, changed, healed } };
  } catch (e) {
    await finishAudit(admin, auditId, { ...entry, outcome: 'failed' });
    console.error('[settingsStore] save failed', opts.entity, (e as Error)?.message);
    return { status: 500, body: { success: false, error: 'The settings could not be saved. Please try again.' } };
  }
}