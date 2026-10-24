/**
 * Working Hours — central source of truth for staff availability.
 * Each TeamMember has their own working_hours + special_hours.
 * Used by Calendar, Create Booking Request, Manual Booking, and validation logic.
 */
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

export const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const DEFAULT_WORKING_HOURS = [
  { day_of_week: 'Monday', is_open: false, open_time: 9, close_time: 17 },
  { day_of_week: 'Tuesday', is_open: true, open_time: 9, close_time: 17 },
  { day_of_week: 'Wednesday', is_open: true, open_time: 9, close_time: 17 },
  { day_of_week: 'Thursday', is_open: true, open_time: 9, close_time: 20 },
  { day_of_week: 'Friday', is_open: true, open_time: 9, close_time: 20 },
  { day_of_week: 'Saturday', is_open: true, open_time: 7, close_time: 15 },
  { day_of_week: 'Sunday', is_open: false, open_time: 9, close_time: 17 },
];

// Backward-compat alias
export const DEFAULT_BUSINESS_HOURS = DEFAULT_WORKING_HOURS;

// ── Team Member cache ──────────────────────────────────────────────────
let _membersCache = null;
let _membersPromise = null;

export function loadTeamMembers() {
  if (_membersCache) return Promise.resolve(_membersCache);
  if (_membersPromise) return _membersPromise;
  _membersPromise = base44.entities.TeamMember.list('-created_date', 50).then(members => {
    _membersCache = members;
    return members;
  }).catch(() => {
    _membersCache = [];
    return _membersCache;
  });
  return _membersPromise;
}

export function invalidateTeamMembersCache() {
  _membersCache = null;
  _membersPromise = null;
}

// ── Hooks ──────────────────────────────────────────────────────────────

/** Load all team members */
export function useTeamMembers() {
  const [members, setMembers] = useState(_membersCache || []);
  const [loading, setLoading] = useState(!_membersCache);
  useEffect(() => {
    let active = true;
    loadTeamMembers().then(m => {
      if (active) { setMembers(m); setLoading(false); }
    });
    return () => { active = false; };
  }, []);
  const reload = () => {
    invalidateTeamMembersCache();
    setLoading(true);
    loadTeamMembers().then(m => { setMembers(m); setLoading(false); });
  };
  return { members, loading, reload };
}

/** Load a specific team member's working hours (returns same shape as useBusinessHours) */
export function useStaffHours(teamMemberId) {
  const { members, loading } = useTeamMembers();
  const member = members.find(m => m.id === teamMemberId);
  const hours = member?.working_hours?.length ? member.working_hours : DEFAULT_WORKING_HOURS;
  return { hours, specialHours: member?.special_hours || [], member, loading };
}

/** Backward-compat: loads the first team member's hours (or defaults) */
export function useBusinessHours() {
  const { members, loading } = useTeamMembers();
  const firstMember = members[0];
  const hours = firstMember?.working_hours?.length ? firstMember.working_hours : DEFAULT_WORKING_HOURS;
  return { hours, loading, member: firstMember };
}

// ── Utility functions (work with any hours array) ───────────────────────

export function getDayHours(hours, dayName) {
  return hours.find(h => h.day_of_week === dayName);
}

export function isDayOpen(hours, dayName) {
  const d = getDayHours(hours, dayName);
  return !!(d && d.is_open);
}

export function getOperatingBounds(hours, dayName) {
  const d = getDayHours(hours, dayName);
  if (!d || !d.is_open) return null;
  return { start: d.open_time, end: d.close_time };
}

export function isWithinOperatingHours(hours, dayName, decimalTime) {
  const b = getOperatingBounds(hours, dayName);
  if (!b) return false;
  return decimalTime >= b.start && decimalTime <= b.end;
}

/** Overall earliest-open / latest-close across all open days (for calendar grid range) */
export function getOverallBounds(hours) {
  const open = hours.filter(h => h.is_open);
  if (open.length === 0) return { start: 8, end: 18 };
  return {
    start: Math.min(...open.map(h => h.open_time)),
    end: Math.max(...open.map(h => h.close_time)),
  };
}

/** Union bounds across multiple team members (for "All barbers" calendar view) */
export function getUnionHours(members) {
  if (!members || members.length === 0) return DEFAULT_WORKING_HOURS;
  return DAYS_OF_WEEK.map(day => {
    const dayHours = members
      .filter(m => m.is_bookable && m.status === 'Active')
      .map(m => getDayHours(m.working_hours || DEFAULT_WORKING_HOURS, day))
      .filter(h => h && h.is_open);
    if (dayHours.length === 0) {
      return { day_of_week: day, is_open: false, open_time: 9, close_time: 17 };
    }
    return {
      day_of_week: day,
      is_open: true,
      open_time: Math.min(...dayHours.map(h => h.open_time)),
      close_time: Math.max(...dayHours.map(h => h.close_time)),
    };
  });
}

// ── Special hours ──────────────────────────────────────────────────────

/** Get special hours for a specific date (YYYY-MM-DD) */
export function getSpecialHoursForDate(specialHours, dateStr) {
  if (!specialHours || !dateStr) return null;
  return specialHours.find(s => s.date === dateStr) || null;
}

/** Get effective bounds for a day, considering special hours override */
export function getEffectiveBounds(workingHours, specialHours, dayName, dateStr) {
  const special = getSpecialHoursForDate(specialHours, dateStr);
  if (special) {
    if (!special.is_open) return null;
    return { start: special.open_time, end: special.close_time };
  }
  return getOperatingBounds(workingHours, dayName);
}