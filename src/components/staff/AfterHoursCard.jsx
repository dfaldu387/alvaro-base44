/**
 * AfterHoursCard — After-hours appointment rules for a team member.
 * Controls how after-hours appointments are handled.
 * After-hours appointments sit outside both normal and extended hours.
 */
import AdminCard from '@/components/admin/ui/AdminCard';
import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0', value ? 'bg-[#5E42F3]' : 'bg-zinc-300')}
    >
      <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform', value && 'translate-x-4')} />
    </button>
  );
}

function AfterHoursToggle({ label, description, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex-1 min-w-0 pr-3">
        <p className="text-sm font-medium text-zinc-700">{label}</p>
        {description && <p className="text-xs text-zinc-400 mt-0.5">{description}</p>}
      </div>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

export default function AfterHoursCard({
  manualApproval,
  allowGroups,
  allowPriority,
  onManualApproval,
  onAllowGroups,
  onAllowPriority,
}) {
  return (
    <AdminCard className="p-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-zinc-100">
        <h3 className="text-sm font-bold text-zinc-900">After hours</h3>
        <p className="text-xs text-zinc-500 mt-0.5">Control how after-hours appointments are handled.</p>
      </div>

      {/* Body */}
      <div className="px-4 py-1 divide-y divide-zinc-50">
        <AfterHoursToggle
          label="Manual approval only"
          description="Require admin approval for after-hours bookings"
          value={manualApproval}
          onChange={onManualApproval}
        />
        <AfterHoursToggle
          label="Allow for group bookings"
          description="Permit after-hours for group bookings"
          value={allowGroups}
          onChange={onAllowGroups}
        />
        <AfterHoursToggle
          label="Allow for priority/high-value bookings"
          description="Permit after-hours for priority clients"
          value={allowPriority}
          onChange={onAllowPriority}
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-zinc-50/50 border-t border-zinc-100">
        <div className="flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-500 leading-relaxed">
            After-hours appointments sit outside both normal and extended hours.
          </p>
        </div>
      </div>
    </AdminCard>
  );
}