/**
 * StaffPermissions — overview of role-based permissions.
 * Read-only informational page.
 */
import React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import AdminPage from '@/components/admin/ui/AdminPage';
import AdminCard from '@/components/admin/ui/AdminCard';

const ROLES = [
  {
    name: 'Owner',
    description: 'Full access to everything',
    permissions: [
      { label: 'Edit all team members', granted: true },
      { label: "Edit everyone's working hours", granted: true },
      { label: 'Manage services', granted: true },
      { label: 'Change permissions', granted: true },
      { label: 'View all appointments', granted: true },
      { label: 'Manage calendar and bookings', granted: true },
    ],
  },
  {
    name: 'Admin',
    description: 'Manage team and services, cannot change permissions',
    permissions: [
      { label: 'Edit all team members', granted: true },
      { label: "Edit everyone's working hours", granted: true },
      { label: 'Manage services', granted: true },
      { label: 'Change permissions', granted: false },
      { label: 'View all appointments', granted: true },
      { label: 'Manage calendar and bookings', granted: true },
    ],
  },
  {
    name: 'Barber',
    description: 'Manage own appointments and working hours',
    permissions: [
      { label: 'Edit own working hours', granted: true },
      { label: 'View/manage own appointments', granted: true },
      { label: "Edit another barber's settings", granted: false },
      { label: 'Manage services', granted: false },
      { label: 'Change permissions', granted: false },
      { label: 'View all appointments', granted: false },
    ],
  },
];

export default function StaffPermissions() {
  return (
    <AdminPage title="Permissions" subtitle="Role-based access control for your team">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ROLES.map(role => (
            <AdminCard key={role.name} className="p-5">
              <h3 className="text-base font-bold text-zinc-900">{role.name}</h3>
              <p className="text-xs text-zinc-500 mt-0.5 mb-4">{role.description}</p>
              <div className="space-y-2.5">
                {role.permissions.map((p, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className={cn('w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                      p.granted ? 'bg-emerald-100' : 'bg-zinc-100')}>
                      {p.granted
                        ? <Check className="w-3 h-3 text-emerald-600" />
                        : <X className="w-3 h-3 text-zinc-400" />}
                    </div>
                    <span className={cn('text-xs', p.granted ? 'text-zinc-700' : 'text-zinc-400')}>
                      {p.label}
                    </span>
                  </div>
                ))}
              </div>
            </AdminCard>
          ))}
        </div>
    </AdminPage>
  );
}