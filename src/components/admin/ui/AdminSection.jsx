import React from 'react';
import AdminCard from '@/components/admin/ui/AdminCard';

// A titled card section.
export default function AdminSection({ title, description, actions, children }) {
  return (
    <AdminCard>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            {title && <h2 className="font-semibold text-zinc-900">{title}</h2>}
            {description && <p className="text-sm text-zinc-500 mt-0.5">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </AdminCard>
  );
}