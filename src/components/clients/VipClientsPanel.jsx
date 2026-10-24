import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Crown, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import AdminCard from '@/components/admin/ui/AdminCard';
import StatusBadge from '@/components/admin/ui/StatusBadge';

const DAYS = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Recurring VIP clients, managed from the Clients page. */
export default function VipClientsPanel() {
  const [vips, setVips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');

  const loadVips = async () => {
    setLoading(true);
    const list = await base44.entities.VIPClient.list('-created_date', 50);
    setVips(Array.isArray(list) ? list : (list?.items || []));
    setLoading(false);
  };

  useEffect(() => { loadVips(); }, []);

  const handleAdd = async () => {
    if (!name || !day || !time) return;
    setSaving(true);
    await base44.entities.VIPClient.create({ client_name: name, address, recurring_day: day, recurring_time: time, is_active: true });
    setName(''); setAddress(''); setDay(''); setTime('');
    setShowForm(false);
    toast({ title: 'VIP Added', description: `${name} added as a recurring VIP.` });
    await loadVips();
    setSaving(false);
  };

  const handleDelete = async (id) => {
    await base44.entities.VIPClient.delete(id);
    toast({ title: 'VIP Removed' });
    await loadVips();
  };

  const handleToggle = async (vip) => {
    await base44.entities.VIPClient.update(vip.id, { is_active: !vip.is_active });
    await loadVips();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? <X className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
          {showForm ? 'Close' : 'Add VIP'}
        </Button>
      </div>

      {showForm && (
        <AdminCard className="max-w-xl space-y-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Client name" />
          <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Suburb / Address" />
          <Select value={day} onValueChange={setDay}>
            <SelectTrigger><SelectValue placeholder="Recurring day" /></SelectTrigger>
            <SelectContent>
              {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={time} onChange={e => setTime(e.target.value)} placeholder="Time e.g. 11:00am" />
          <Button className="w-full" onClick={handleAdd} disabled={saving || !name || !day || !time}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Add VIP Client
          </Button>
        </AdminCard>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
      ) : vips.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">No VIP clients yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {vips.map(vip => (
            <AdminCard key={vip.id} className={`flex items-center justify-between gap-3 ${vip.is_active ? '' : 'opacity-60'}`}>
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50">
                  <Crown className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900">{vip.client_name}</p>
                  <p className="text-xs text-zinc-500">Every {vip.recurring_day} · {vip.recurring_time}</p>
                  {vip.address && <p className="truncate text-xs text-zinc-500">{vip.address}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => handleToggle(vip)} className="min-h-[44px] px-1" aria-label="Toggle active">
                  <StatusBadge tone={vip.is_active ? 'success' : 'neutral'}>{vip.is_active ? 'Active' : 'Paused'}</StatusBadge>
                </button>
                <button onClick={() => handleDelete(vip.id)} className="flex h-11 w-11 items-center justify-center text-zinc-400 transition-colors hover:text-red-600" aria-label="Remove VIP">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </AdminCard>
          ))}
        </div>
      )}
    </div>
  );
}