import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';
import { Save, Loader2, Info, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WEEK_DAYS } from '@/lib/serviceAreaUtils';
import AdminPage from '@/components/admin/ui/AdminPage';
import AdminCard from '@/components/admin/ui/AdminCard';
import AdminSection from '@/components/admin/ui/AdminSection';
import WeeklyHoursCard from '@/components/admin/availability/WeeklyHoursCard';

// Bookable Hours — edits the default public booking barber's TeamMember.working_hours.
// This is the single source of truth for WHEN bookings are accepted.
// Service Zones are NOT involved here — they only control WHERE (priority area).
export default function BookingAvailability() {
  const [barber, setBarber] = useState(null);
  const [hours, setHours] = useState([]);
  const [originalHours, setOriginalHours] = useState([]);
  const [capacity, setCapacity] = useState(8);
  const [originalCapacity, setOriginalCapacity] = useState(8);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.TeamMember.list('-created_date', 200),
      base44.entities.GroupDiscountSettings.list('-created_date', 50),
    ]).then(([members, gdRecords]) => {
      // Find the default public booking barber (same logic as publicBookingData)
      const rolePriority = { owner: 0, admin: 1, barber: 2 };
      const defaultBarber = (members || [])
        .filter(m => m.is_bookable !== false && m.status === 'Active')
        .sort((a, b) => (rolePriority[a.role] ?? 9) - (rolePriority[b.role] ?? 9))[0] || null;

      if (defaultBarber) {
        setBarber(defaultBarber);
        // Ensure all 7 days are represented, sorted by weekday order
        const existing = {};
        for (const wh of (defaultBarber.working_hours || [])) existing[wh.day_of_week] = wh;
        const fullWeek = WEEK_DAYS.map(day =>
          existing[day] || { day_of_week: day, is_open: false, open_time: 9, close_time: 17 }
        );
        setHours(fullWeek);
        setOriginalHours(JSON.parse(JSON.stringify(fullWeek)));
      }

      // Capacity from GroupDiscountSettings business default
      const gdDefault = (gdRecords || []).find(s => !s.team_member_id) || (gdRecords || [])[0];
      if (gdDefault) {
        setCapacity(gdDefault.max_bookings_per_day ?? 8);
        setOriginalCapacity(gdDefault.max_bookings_per_day ?? 8);
      }
    }).finally(() => setLoading(false));
  }, []);

  const hoursDirty = JSON.stringify(hours) !== JSON.stringify(originalHours);
  const capacityDirty = capacity !== originalCapacity;
  const isDirty = hoursDirty || capacityDirty;

  const updateHour = (dayName, patch) => {
    setHours(prev => prev.map(h => h.day_of_week === dayName ? { ...h, ...patch } : h));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save barber working hours to TeamMember entity
      if (barber && hoursDirty) {
        await base44.entities.TeamMember.update(barber.id, { working_hours: hours });
        setOriginalHours(JSON.parse(JSON.stringify(hours)));
      }

      // Save capacity to GroupDiscountSettings
      if (capacityDirty) {
        // Only the cap is sent: the discount tiers and coverage radii belong to other screens.
        await saveSettings('GroupDiscountSettings', 'availability', { max_bookings_per_day: capacity });
        setOriginalCapacity(capacity);
      }

      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!barber) {
    return (
      <AdminPage title="Bookable Hours">
        <AdminCard className="border-amber-200 bg-amber-50 max-w-2xl">
          <p className="text-sm font-semibold text-zinc-900">No bookable barber found</p>
          <p className="text-xs text-zinc-500 mt-1">Add a Team Member with status "Active" and "Bookable" enabled to configure working hours.</p>
        </AdminCard>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="Bookable Hours"
      subtitle="These are your working hours — the source of truth for which dates customers can book. Service Zones only control where you prioritise; they do not affect availability."
    >
      <div className="max-w-2xl space-y-4 pb-20">
        <AdminCard className="flex items-center gap-2.5 border-indigo-200 bg-indigo-50 py-3">
          <User className="w-4 h-4 text-indigo-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-zinc-900">Editing schedule for: {barber.name}</p>
            <p className="text-xs text-zinc-500">{barber.role} · {barber.job_title || 'Barber'}</p>
          </div>
        </AdminCard>

        <AdminCard className="flex items-start gap-2.5 border-indigo-200 bg-indigo-50 py-3">
          <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-zinc-900">Barber schedule = WHEN · Service Zones = WHERE</p>
            <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
              A date is bookable if it's enabled here. Service Zones add a priority label but never open or close a day.
            </p>
          </div>
        </AdminCard>

        <WeeklyHoursCard hours={hours} onChange={updateHour} />

        <AdminSection title="Booking Capacity" description="Maximum booking requests accepted per day.">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-zinc-900">Max bookings per day</p>
              <p className="text-xs text-zinc-500 mt-0.5">Counts booking requests, not add-ons or people.</p>
            </div>
            <Input
              type="number"
              min={1}
              max={60}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 shrink-0 h-11 sm:h-10 text-center bg-white"
            />
          </div>
        </AdminSection>
      </div>

      {/* Save bar */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-20 bg-white border-t border-zinc-200 px-4 py-3">
        <Button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className={`w-full min-h-[44px] gap-2 font-bold ${savedFlash ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : ''}`}
        >
          {savedFlash ? (
            <><Save className="w-4 h-4" /> Saved</>
          ) : saving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
          ) : (
            <><Save className="w-4 h-4" /> Save Changes</>
          )}
        </Button>
      </div>
    </AdminPage>
  );
}