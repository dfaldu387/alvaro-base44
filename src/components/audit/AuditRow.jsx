import React from 'react';
import AdminCard from '@/components/admin/ui/AdminCard';
import { formatWhen } from '@/lib/auditTrail';

const OUTCOME = { failed: 'Failed', aborted: 'Stopped' };

// One audit entry: what happened, when, who did it, and the (already scrubbed) detail.
export default function AuditRow({ item }) {
  return (
    <AdminCard className="space-y-1 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-zinc-900 break-words min-w-0">{item.what}</p>
        {OUTCOME[item.outcome] && <span className="text-[11px] font-semibold text-red-700 bg-red-50 rounded-full px-2 py-0.5">{OUTCOME[item.outcome]}</span>}
      </div>
      <p className="text-xs text-zinc-500 break-words">
        {formatWhen(item.when)} · {item.automatic ? 'Automatic' : `By ${item.who}`}
      </p>
      {item.detail && <p className="text-xs text-zinc-600 break-words">{item.detail}</p>}
    </AdminCard>
  );
}