import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { saveSettings } from '@/lib/settingsApi';
import MainServiceCentreCard from '@/components/admin/servicecoverage/MainServiceCentreCard';
import CoverageZoneList from '@/components/admin/servicecoverage/CoverageZoneList';
import CoverageMap from '@/components/admin/servicecoverage/CoverageMap';
import CoverageZoneEditor from '@/components/admin/servicecoverage/CoverageZoneEditor';
import { newServiceDays } from '@/lib/serviceAreaUtils';
import AdminPage from '@/components/admin/ui/AdminPage';
import AdminCard from '@/components/admin/ui/AdminCard';
import { Button } from '@/components/ui/button';

function MiniToggle({ checked, onChange, label }) {
  return (
    <button onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 group min-h-[44px] sm:min-h-0">
      <span className={`relative w-8 h-4 rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-zinc-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
      <span className={`text-xs font-medium transition-colors ${checked ? 'text-zinc-900' : 'text-zinc-500'}`}>{label}</span>
    </button>
  );
}

// Service Coverage — single page for all geographic settings.
// Top: compact Main Service Centre bar.
// Middle: 3-column workspace (zones | map + toggles | editor).
// Bottom: compact Booking Preview reusing the actual customer Step 1.
// One zone = one centre + one radius + one colour = one circle on the map.
export default function ServiceCoverage() {
  const [areas, setAreas] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [myTeamMemberId, setMyTeamMemberId] = useState(null);
  const [centre, setCentre] = useState({ lat: -33.87, lng: 151.21, address: '' });
  const [extendedRadius, setExtendedRadius] = useState(25);
  const [maxRadius, setMaxRadius] = useState(35);
  const [showExtended, setShowExtended] = useState(false);
  const [showMax, setShowMax] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [draftZone, setDraftZone] = useState(null);
  const [pendingSelectId, setPendingSelectId] = useState(null);
  const [flyTrigger, setFlyTrigger] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const [areaRecords, members, me, settingsRecords] = await Promise.all([
        base44.entities.ServiceArea.list('sort_order', 200),
        base44.entities.TeamMember.list('-created_date', 200),
        base44.auth.me().catch(() => null),
        base44.entities.GroupDiscountSettings.list('-created_date', 50),
      ]);
      setAreas(areaRecords || []);
      setTeamMembers((members || []).filter(m => m.status !== 'Inactive'));
      setCurrentUser(me);
      const biz = (settingsRecords || []).find(r => !r.team_member_id) || (settingsRecords || [])[0] || null;
      if (biz) {
        setCentre({ lat: biz.service_centre_lat ?? -33.87, lng: biz.service_centre_lng ?? 151.21, address: biz.service_centre_address || '' });
        setExtendedRadius(biz.extended_radius_km ?? 25);
        setMaxRadius(biz.maximum_service_radius_km ?? 35);
      }
      if (me && me.role !== 'admin') {
        const mine = (members || []).find(m => m.user_id === me.id);
        setMyTeamMemberId(mine ? mine.id : null);
      }
    } catch (e) {
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isAdmin = !currentUser || currentUser.role === 'admin';

  const visibleAreas = useMemo(() => {
    let list = areas;
    if (!isAdmin) list = list.filter(a => a.team_member_id === myTeamMemberId);
    return list.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  }, [areas, isAdmin, myTeamMemberId]);

  const selectedArea = useMemo(() => {
    const list = isAdmin ? areas : areas.filter(a => a.team_member_id === myTeamMemberId);
    return list.find(a => a.id === selectedId) || null;
  }, [areas, selectedId, isAdmin, myTeamMemberId]);

  useEffect(() => {
    if (selectedArea) setDraftZone(selectedArea);
    else setDraftZone(null);
  }, [selectedArea?.id]);

  const isDirty = useMemo(() => {
    if (!draftZone || !selectedArea) return false;
    return JSON.stringify(draftZone) !== JSON.stringify(selectedArea);
  }, [draftZone, selectedArea]);

  const canEdit = (area) => {
    if (!area) return false;
    if (isAdmin) return true;
    return area.team_member_id === myTeamMemberId;
  };

  const handleSelect = (id) => {
    if (id === selectedId) return;
    if (isDirty) setPendingSelectId(id);
    else setSelectedId(id);
  };

  const handleAdd = () => {
    if (isDirty) { setPendingSelectId('__new__'); return; }
    createNewZone();
  };

  const createNewZone = () => {
    const draft = {
      name: '', description: '',
      team_member_id: isAdmin ? null : myTeamMemberId, team_member_name: '',
      active: true, geometry: null, suburbs: [], postcodes: [],
      service_days: newServiceDays(), max_bookings_per_day: 8,
      centre_suburb: '', latitude: null, longitude: null,
      radius_km: 10, colour: '#8B5CF6',
    };
    const tempId = `new-${Date.now()}`;
    setAreas(prev => [{ ...draft, id: tempId }, ...prev]);
    setSelectedId(tempId);
  };

  const handleConfirmDiscard = () => {
    if (pendingSelectId === '__new__') createNewZone();
    else if (pendingSelectId) setSelectedId(pendingSelectId);
    setPendingSelectId(null);
  };

  const handleSetCurrentLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setCentre({ lat: pos.coords.latitude, lng: pos.coords.longitude, address: 'Current location' });
    });
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const centrePayload = {
        service_centre_lat: centre.lat,
        service_centre_lng: centre.lng,
        service_centre_address: centre.address,
        extended_radius_km: extendedRadius,
        maximum_service_radius_km: maxRadius,
      };
      // The centre and radii are business settings: admins only. A barber still saves their own zone below.
      // Only these coverage fields are sent, so the daily cap and discount tiers are never touched.
      if (isAdmin) await saveSettings('GroupDiscountSettings', 'coverage', centrePayload);

      if (isDirty && draftZone) {
        const { id, ...rest } = draftZone;
        const assignedMember = teamMembers.find(t => t.id === rest.team_member_id);
        const clean = {
          name: rest.name, description: rest.description || '',
          team_member_id: rest.team_member_id || null, team_member_name: assignedMember ? assignedMember.name : '',
          active: rest.active !== false, suburbs: rest.suburbs || [], postcodes: rest.postcodes || [],
          service_days: rest.service_days || [], max_bookings_per_day: rest.max_bookings_per_day ?? 8,
          centre_suburb: rest.centre_suburb || '', latitude: rest.latitude ?? null, longitude: rest.longitude ?? null,
          radius_km: rest.radius_km ?? 10, colour: rest.colour || '#8B5CF6',
        };
        let saved;
        if (id && String(id).startsWith('new-')) saved = await base44.entities.ServiceArea.create(clean);
        else if (id) saved = await base44.entities.ServiceArea.update(id, clean);
        if (saved) {
          setAreas(prev => [saved, ...prev.filter(a => a.id !== id)]);
          setSelectedId(saved.id);
          setDraftZone(saved);
        }
      }

      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (area) => {
    if (!isAdmin) return;
    if (!window.confirm(`Delete the "${area.name}" service zone? This cannot be undone.`)) return;
    try {
      await base44.entities.ServiceArea.delete(area.id);
      setAreas(prev => prev.filter(a => a.id !== area.id));
      setSelectedId(null);
    } catch (e) {}
  };

  if (loading) {
    return <div className="min-h-[50vh] flex items-center justify-center bg-white"><div className="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (loadError) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center bg-white p-6">
        <div className="text-center max-w-sm">
          <p className="text-sm font-semibold text-zinc-900">Couldn't load service coverage</p>
          <Button onClick={() => load()} className="mt-4 min-h-[44px]">Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <AdminPage title="Service Coverage" subtitle="Set your coverage centre and manage service zones.">
      <AdminCard>
        <MainServiceCentreCard
          centre={centre}
          onCentreChange={setCentre}
          onSetCurrentLocation={handleSetCurrentLocation}
          extendedRadius={extendedRadius}
          onExtendedRadiusChange={setExtendedRadius}
          maxRadius={maxRadius}
          onMaxRadiusChange={setMaxRadius}
          onSave={handleSaveAll}
          saving={saving}
          savedFlash={savedFlash}
        />
      </AdminCard>

      {/* Workspace: 3 columns on desktop, stacked on phones */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_340px] lg:h-[calc(100vh-260px)] min-h-[600px] border border-zinc-200 rounded-xl overflow-hidden bg-white">
        {/* Zones list */}
        <div className="border-b lg:border-b-0 lg:border-r border-zinc-200 flex flex-col min-h-0 max-h-[320px] lg:max-h-none">
          <CoverageZoneList areas={visibleAreas} selectedId={selectedId} onSelect={handleSelect} onAdd={handleAdd} canAdd={isAdmin} />
        </div>

        {/* Map + toggles */}
        <div className="flex flex-col min-h-0">
          <div className="px-4 py-1 sm:py-2.5 border-b border-zinc-200 flex flex-wrap items-center gap-x-6">
            <MiniToggle checked={showExtended} onChange={setShowExtended} label="Show extended radius" />
            <MiniToggle checked={showMax} onChange={setShowMax} label="Show max radius" />
          </div>
          <div className="flex-1 min-h-0 relative">
            <CoverageMap
              areas={visibleAreas}
              selectedId={selectedId}
              onSelect={handleSelect}
              draftZone={draftZone}
              centre={centre.lat != null ? centre : null}
              flyTrigger={flyTrigger}
              showExtended={showExtended}
              showMax={showMax}
              extendedRadiusKm={extendedRadius}
              maxRadiusKm={maxRadius}
            />
          </div>
        </div>

        {/* Editor */}
        <div className="border-t lg:border-t-0 lg:border-l border-zinc-200 flex flex-col min-h-0">
          <CoverageZoneEditor
            draft={draftZone}
            onChange={setDraftZone}
            teamMembers={teamMembers}
            canEdit={canEdit(selectedArea)}
            onDelete={isAdmin ? handleDelete : null}
            onGeocoded={() => setFlyTrigger(t => t + 1)}
          />
        </div>
      </div>

      {/* Unsaved changes modal */}
      {pendingSelectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white border border-zinc-200 shadow-2xl p-5">
            <h3 className="text-base font-bold text-zinc-900">Unsaved changes</h3>
            <p className="text-sm text-zinc-500 mt-1.5">Save them first, or discard to switch zones.</p>
            <div className="flex items-center gap-2 mt-4">
              <Button variant="outline" onClick={() => setPendingSelectId(null)} className="flex-1 min-h-[44px]">Cancel</Button>
              <Button variant="outline" onClick={handleConfirmDiscard} className="flex-1 min-h-[44px] border-red-200 text-red-600 hover:bg-red-50">Discard</Button>
              <Button onClick={async () => { await handleSaveAll(); handleConfirmDiscard(); }} disabled={saving} className="flex-1 min-h-[44px]">{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  );
}