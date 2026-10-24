import React from 'react';
import { Clock, Scissors } from 'lucide-react';
import ActionMenu from './ActionMenu';
import StatusBadge from '@/components/admin/ui/StatusBadge';

export default function ServiceCard({ service, addonNames, onMenu }) {
  const addonLabel = addonNames.length > 1 ? 'Popular add-ons' : addonNames.length === 1 ? 'Pairs with' : '';
  return (
    <div className="flex items-center gap-4 bg-white border border-zinc-200 rounded-xl p-3.5 hover:shadow-sm transition-shadow">
      <div className="w-16 h-16 rounded-lg overflow-hidden bg-zinc-100 flex items-center justify-center shrink-0">
        {service.photo_url
          ? <img src={service.photo_url} alt={service.name} className="w-full h-full object-cover" />
          : <Scissors className="w-6 h-6 text-zinc-300" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-zinc-900">{service.name}</p>
          {service.is_active === false && <StatusBadge status="suppressed">Inactive</StatusBadge>}
        </div>
        <p className="text-sm mt-0.5">
          <span className="text-violet-600 font-semibold">${service.price}</span>
          <span className="text-zinc-300 mx-1.5">·</span>
          <span className="text-zinc-500 inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Approx. {service.duration_mins} mins</span>
        </p>
        {addonLabel && (
          <p className="text-xs text-zinc-400 mt-1 truncate">{addonLabel}: {addonNames.join(', ')}</p>
        )}
      </div>
      <ActionMenu items={onMenu} />
    </div>
  );
}