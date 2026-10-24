import React from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSection from '@/components/admin/ui/AdminSection';
import Figure from '@/components/reports/Figure';

export default function ClientsSection({ clients, onDrill }) {
  const navigate = useNavigate();
  const none = clients.servicedCount === 0;
  const why = 'No bookings were completed in this range.';
  const link = clients.unlinked ? ` ${clients.unlinked} serviced booking(s) are not linked to a client record, so they are not split into new or returning.` : '';
  const od = clients.overdueCount;
  return (
    <AdminSection title="Clients" description="Who was serviced, and which regulars are due a cut right now.">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Figure label="Clients serviced" value={none ? null : clients.servicedCount} reason={why}
          onClick={() => onDrill({ title: 'Clients serviced', rows: clients.servicedRows, empty: why })} />
        <Figure label="New clients" value={none ? null : clients.newCount} reason={why} sub="First ever completed cut was in this range"
          onClick={() => onDrill({ title: 'New clients', note: `No completed booking before this range.${link}`, rows: clients.newRows, empty: why })} />
        <Figure label="Returning clients" value={none ? null : clients.returningCount} reason={why} sub="Had a completed cut before this range"
          onClick={() => onDrill({ title: 'Returning clients', note: `Completed a booking before this range.${link}`, rows: clients.returningRows, empty: why })} />
        <Figure label="Regulars overdue now" value={clients.regularsCount === 0 ? null : od}
          reason="No active regular clients are set up."
          sub={clients.noHistoryCount ? `${clients.noHistoryCount} regular(s) have no visit on record and are not counted` : 'Money not yet collected. Not affected by the range.'}
          onClick={() => onDrill({ title: 'Regulars overdue for a cut', note: 'Last visit is older than their usual frequency. These are the campaign\'s input.', rows: clients.overdueRows, empty: 'No regulars are overdue.' })} />
      </div>
      {od > 0 && (
        <button onClick={() => navigate('/admin/reminders?tab=campaigns')} className="mt-3 text-xs text-indigo-600 hover:text-indigo-700">
          Open the campaign to reach these {od} client{od === 1 ? '' : 's'}
        </button>
      )}
    </AdminSection>
  );
}