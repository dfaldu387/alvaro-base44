import React from 'react';
import { Briefcase, Package } from 'lucide-react';
import ActionMenu from './ActionMenu';
import StatusBadge from '@/components/admin/ui/StatusBadge';

export default function ProductCard({ product, serviceNames, onMenu }) {
  const stock = product.stock_quantity <= 0 ? { label: 'Out of stock', cls: 'text-red-600' }
    : product.stock_quantity <= (product.low_stock_threshold || 5) ? { label: 'Low stock', cls: 'text-amber-600' }
    : { label: 'In stock', cls: 'text-emerald-600' };
  return (
    <div className="flex items-center gap-4 bg-white border border-zinc-200 rounded-xl p-3.5 hover:shadow-sm transition-shadow">
      <div className="w-16 h-16 rounded-lg overflow-hidden bg-zinc-100 flex items-center justify-center shrink-0">
        {product.photo_url
          ? <img src={product.photo_url} alt={product.name} className="w-full h-full object-cover" />
          : <Briefcase className="w-6 h-6 text-zinc-300" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-zinc-900">{product.name}</p>
          {product.is_active === false && <StatusBadge status="suppressed">Inactive</StatusBadge>}
        </div>
        <p className="text-sm mt-0.5">
          <span className="text-violet-600 font-semibold">${product.selling_price}</span>
          <span className="text-zinc-300 mx-1.5">·</span>
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${stock.cls}`}><Package className="w-3.5 h-3.5" /> {stock.label} ({product.stock_quantity || 0})</span>
        </p>
        {serviceNames.length > 0 && (
          <p className="text-xs text-zinc-400 mt-1 truncate">Suggested after: {serviceNames.join(', ')}</p>
        )}
      </div>
      <ActionMenu items={onMenu} />
    </div>
  );
}