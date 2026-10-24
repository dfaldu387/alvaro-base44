import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import { computeBlockCounts, countToDemandLevel, TIME_BLOCK_RANGES } from '@/lib/demandUtils';
import DemandBadge from '@/components/booking/DemandBadge';
import AdminPage from '@/components/admin/ui/AdminPage';
import AdminCard from '@/components/admin/ui/AdminCard';

const DAYS = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME_BLOCKS = ['Morning', 'Midday', 'Afternoon', 'Evening'];

export default function DemandSettings() {
  const [allRequests, setAllRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Booking demand analytics exclude test bookings.
    base44.entities.BookingRequest.filter({ is_test: { $ne: true } }, '-created_date', 500)
      .then(setAllRequests)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <AdminPage
      title="General Settings"
      subtitle="How full the week already is. Demand is counted from live client requests and updates as new ones come in."
    >
      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Booking demand</h2>
      <AdminCard className="bg-zinc-50 text-xs text-zinc-500 space-y-1">
        <p className="font-medium text-zinc-900">Demand Rules</p>
        <p>🟢 <span className="text-green-700">Best Availability</span> — 0–3 requests</p>
        <p>🟡 <span className="text-yellow-700">Limited Availability</span> — 4–6 requests</p>
        <p>🔴 <span className="text-red-700">High Demand</span> — 7+ requests</p>
      </AdminCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {DAYS.map(day => {
          const dayReqs = allRequests.filter(r => r.day === day && r.status !== 'declined');
          const counts = computeBlockCounts(dayReqs);

          return (
            <AdminCard key={day} className="p-0 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
                <span className="font-semibold text-zinc-900">{day}</span>
                <span className="text-xs text-zinc-500">{dayReqs.length} total request{dayReqs.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="grid grid-cols-2 gap-0">
                {TIME_BLOCKS.map((block, i) => {
                  const count = counts[block] || 0;
                  const level = countToDemandLevel(count);
                  const isRight = i % 2 === 1;
                  const isBottom = i >= 2;
                  return (
                    <div
                      key={block}
                      className={`p-3 ${isRight ? '' : 'border-r border-zinc-200'} ${isBottom ? '' : 'border-b border-zinc-200'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-zinc-900">{block}</span>
                        <DemandBadge level={level} compact />
                      </div>
                      <p className="text-[10px] text-zinc-500">{TIME_BLOCK_RANGES[block].label}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              level === 'high_demand' ? 'bg-red-400' : level === 'limited' ? 'bg-yellow-400' : 'bg-green-400'
                            }`}
                            style={{ width: `${Math.min(100, (count / 7) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-zinc-500 w-4 text-right">{count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </AdminCard>
          );
        })}
      </div>
    </AdminPage>
  );
}