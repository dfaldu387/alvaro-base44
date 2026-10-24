import React from 'react';
import AdminPage from '@/components/admin/ui/AdminPage';
import VipClientsPanel from '@/components/clients/VipClientsPanel';

/** Direct route kept working: the same VIP panel is also opened from the Clients page. */
export default function VIPClients() {
  return (
    <AdminPage
      title="VIP Clients"
      subtitle="Recurring appointments that are held for the same day and time."
    >
      <VipClientsPanel />
    </AdminPage>
  );
}