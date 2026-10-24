import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Inbox, SearchX } from 'lucide-react';
import LoadingState from '@/components/states/LoadingState';
import EmptyState from '@/components/states/EmptyState';
import ErrorState from '@/components/states/ErrorState';
import { matchesFilter, isNeedsAction } from '@/lib/requestStatus';
import NeedsAttentionPanel from '@/components/requests/NeedsAttentionPanel';
import RequestCard from '@/components/requests/RequestCard';
import RequestFilters from '@/components/requests/RequestFilters';
import AdminPage from '@/components/admin/ui/AdminPage';
import StatusBadge from '@/components/admin/ui/StatusBadge';

const DEFAULT_FILTERS = { day: 'All', state: 'all', priority: 'All', zone: 'All', tier: 'All' };

import useCalendarAutoSync from '@/hooks/useCalendarAutoSync';

export default function Requests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const loadRequests = () => {
    setLoading(true);
    setLoadError(null);
    // Two server-side reads, merged:
    //   • the recent page — the everyday list
    //   • every request that has no calendar slot yet, read straight from the
    //     server so a request Route Flow could not place can never fall outside
    //     the loaded window and drop out of the admin's view
    Promise.all([
      base44.entities.BookingRequest.list('-created_date', 200),
      base44.entities.BookingRequest.filter(
        { $or: [{ assigned_time: null }, { assigned_time: { $exists: false } }, { schedule_status: 'unscheduled' }] },
        '-created_date', 200,
      ),
    ])
      .then(([recent, unplaced]) => {
        const byId = new Map();
        for (const r of [...(unplaced || []), ...(recent || [])]) byId.set(r.id, r);
        setRequests(Array.from(byId.values()).sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || ''))));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadRequests(); }, []);
  useCalendarAutoSync();

  // Build zone filter options from the requests' service_zone_name
  const zoneOptions = useMemo(() => {
    const set = new Set();
    for (const r of requests) {
      const name = r.service_zone_name || r.service_area_name;
      if (name) set.add(name);
    }
    return ['All', ...Array.from(set).sort()];
  }, [requests]);

  const filtered = requests
    .filter(r => filters.day === 'All' || r.day === filters.day)
    .filter(r => matchesFilter(r, filters.state))
    .filter(r => filters.priority === 'All' || r.priority_status === filters.priority)
    .filter(r => filters.zone === 'All' || (r.service_zone_name || r.service_area_name) === filters.zone)
    .filter(r => filters.tier === 'All' || r.location_tier === filters.tier);

  // Group by date → service zone
  const grouped = useMemo(() => {
    const byDate = {};
    for (const r of filtered) {
      const dateKey = r.requested_date || r.day || 'Unknown';
      if (!byDate[dateKey]) byDate[dateKey] = {};
      const zoneKey = r.service_zone_name || r.service_area_name || 'Unassigned';
      if (!byDate[dateKey][zoneKey]) {
        byDate[dateKey][zoneKey] = { colour: r.service_zone_colour || '#6f22cf', requests: [] };
      }
      byDate[dateKey][zoneKey].requests.push(r);
    }
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // The safety net count: every request still waiting on a placement decision.
  const needsActionCount = requests.filter(r => isNeedsAction(r)).length;

  return (
    <AdminPage
      title="Client Requests"
      subtitle="Every booking request, grouped by date and service zone."
      actions={needsActionCount > 0 && <StatusBadge status="pending" className="text-xs px-2.5 py-1">{needsActionCount} need action</StatusBadge>}
    >
      <NeedsAttentionPanel />

      <RequestFilters filters={filters} setFilters={setFilters} zoneOptions={zoneOptions} needsActionCount={needsActionCount} />

      {loading ? (
        <LoadingState rows={4} />
      ) : loadError ? (
        <ErrorState
          title="Couldn't load booking requests"
          description="Refresh or try again."
          onRetry={loadRequests}
        />
      ) : grouped.length === 0 ? (
        requests.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No booking requests yet"
            description="New customer requests will appear here."
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="No requests match these filters"
            description="Try changing the state, date, zone or tier."
            filtered
            actionLabel="Clear Filters"
            onAction={() => setFilters(DEFAULT_FILTERS)}
          />
        )
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-zinc-500">{filtered.length} request{filtered.length !== 1 ? 's' : ''} — grouped by date and service zone</p>
          {grouped.map(([dateKey, zones]) => (
            <div key={dateKey}>
              <h3 className="text-sm font-bold text-zinc-900 mb-2">{dateKey}</h3>
              <div className="space-y-3">
                {Object.entries(zones).map(([zoneName, { colour, requests: zoneRequests }]) => {
                  const priorityCount = zoneRequests.filter(r => r.priority_status === 'priority').length;
                  const outsideCount = zoneRequests.filter(r => r.priority_status === 'outside_priority').length;
                  return (
                    <div key={zoneName}>
                      <div className="flex flex-wrap items-center gap-2 mb-2 px-1">
                        <span style={{ backgroundColor: colour }} className="w-3 h-3 rounded-full shrink-0" />
                        <span className="text-sm font-semibold text-zinc-900">{zoneName}</span>
                        <span className="text-xs text-zinc-500">— {zoneRequests.length} request{zoneRequests.length !== 1 ? 's' : ''}</span>
                        {priorityCount > 0 && <StatusBadge tone="success">{priorityCount} Priority</StatusBadge>}
                        {outsideCount > 0 && <StatusBadge tone="warning">{outsideCount} Outside</StatusBadge>}
                      </div>
                      <div className="space-y-2 sm:ml-2">
                        {zoneRequests.map(req => (
                          <RequestCard key={req.id} req={req} onUpdate={loadRequests} zoneColour={colour} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminPage>
  );
}