import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Search, Filter, MoreHorizontal, Pause, Play, Download, X, ChevronUp, ChevronDown, Repeat, Trash2, FolderPlus, FolderMinus, Tag, Archive, AlertTriangle, Inbox, SearchX, Star, Crown } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import LoadingState from '@/components/states/LoadingState';
import EmptyState from '@/components/states/EmptyState';
import ErrorState from '@/components/states/ErrorState';
import ClientDrawer from '@/components/clients/ClientDrawer';
import ClientProfileDrawer from '@/components/clients/ClientProfileDrawer';
import ColumnSelector, { ALL_COLUMNS, DEFAULT_COLS } from '@/components/clients/ColumnSelector';
import GroupSelector from '@/components/clients/GroupSelector';
import FilterPanel from '@/components/clients/FilterPanel';
import ImportExportMenu from '@/components/clients/ImportExportMenu';
import ImportWizard from '@/components/clients/ImportWizard';
import ExportDialog from '@/components/clients/ExportDialog';
import TestDataCleanupModal from '@/components/clients/TestDataCleanupModal';
import SortDropdown from '@/components/clients/SortDropdown';
import DeleteClientsModal from '@/components/clients/DeleteClientsModal';
import MergeClientsDialog from '@/components/clients/MergeClientsDialog';
import VipClientsPanel from '@/components/clients/VipClientsPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { mergeClients, createAdminClients } from '@/lib/adminBookingApi';
import FavouriteStar from '@/components/FavouriteStar';
import { initials, FREQUENCY_OPTIONS, CATEGORY_OPTIONS } from '@/lib/reminderUtils';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import {
  CLIENT_STATUSES, STATUS_STYLES, STATUS_ORDER, completedForClient, clientStats,
  relativeVisit, formatVisitDate, frequencyDisplay, availabilityTypeDisplay, systemTags,
  normalisePhone, formatPhoneAu,
  SMART_GROUPS, matchFilters, countActiveFilters,
} from '@/lib/clientStatus';

const SORTABLE = new Set(['client', 'frequency', 'availability_type', 'status', 'last_visit', 'visits', 'first_visit', 'created', 'avg_spend', 'lifetime_spend']);
const EMPTY_FILTERS = {
  status: [], frequency: [], availability: [], recurring: 'any', recurring_paused: false, weekly_confirmation: false,
  no_visits: false, last_visit_35: false, visit_min: '', last_visit_from: '', last_visit_to: '',
  first_visit_from: '', first_visit_to: '', created_from: '', created_to: '',
  has_phone: false, has_email: false, has_address: false, has_notes: false, has_manual_tags: false,
  suburb: [], postcode: [], service: [], avg_min: '', lt_min: '', tx_min: '',
};

const loadCols = () => {
  try { const v = JSON.parse(localStorage.getItem('clients_columns') || 'null'); return v && v.length ? v.filter(k => ALL_COLUMNS.some(c => c.key === k)) : DEFAULT_COLS; } catch { return DEFAULT_COLS; }
};
const loadGroups = () => { try { return JSON.parse(localStorage.getItem('clients_custom_groups') || '[]'); } catch { return []; } };
const saveGroups = (g) => localStorage.setItem('clients_custom_groups', JSON.stringify(g));
const DEFAULT_SORT = { key: 'client', dir: 'asc' };
const loadSort = () => {
  try {
    const v = JSON.parse(localStorage.getItem('clients_sort') || 'null');
    const ok = v && (v.key === 'client' || v.key === 'created') && (v.dir === 'asc' || v.dir === 'desc');
    return ok ? v : DEFAULT_SORT;
  } catch { return DEFAULT_SORT; }
};
const saveSort = (s) => localStorage.setItem('clients_sort', JSON.stringify(s));

export default function Clients() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [visibleCols, setVisibleCols] = useState(loadCols);
  const [sort, setSort] = useState(loadSort);
  const [group, setGroup] = useState('all');
  const [customGroups, setCustomGroups] = useState(loadGroups);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileId, setProfileId] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [testFilter, setTestFilter] = useState('all');
  const [favOnly, setFavOnly] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState([]);
  const [mergeAsk, setMergeAsk] = useState(null);
  // VIP clients live here: a recurring day and time held for a client, opened from
  // this page rather than a separate destination.
  const [vipOpen, setVipOpen] = useState(false);

  useEffect(() => { localStorage.setItem('clients_columns', JSON.stringify(visibleCols)); }, [visibleCols]);
  useEffect(() => { saveSort(sort); }, [sort]);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      base44.entities.ReminderClient.list('-created_date', 500),
      base44.entities.BookingRequest.list('-created_date', 500),
    ]).then(([c, b]) => { setClients(c); setBookings(b); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('group');
    if (g) setGroup(g);
    if (params.get('vip') === '1') setVipOpen(true);
  }, []);

  const enriched = useMemo(() => clients
    .filter(c => !c.archived)
    .map(c => { const completed = completedForClient(bookings, c); return { ...c, _stats: clientStats(c, completed), _completed: completed }; }), [clients, bookings]);

  const suburbs = useMemo(() => [...new Set(clients.map(c => c.suburb).filter(Boolean))].sort(), [clients]);
  const postcodes = useMemo(() => [...new Set(clients.map(c => c.postcode).filter(Boolean))].sort(), [clients]);
  const services = useMemo(() => [...new Set(clients.map(c => c.usual_service).filter(Boolean))].sort(), [clients]);

  const smartCounts = useMemo(() => {
    const m = {};
    SMART_GROUPS.forEach(g => { m[g.key] = enriched.filter(c => g.test(c._stats, c)).length; });
    return m;
  }, [enriched]);

  const grouped = useMemo(() => {
    // Real vs test clients — the selected data view always applies
    let list = enriched;
    if (testFilter === 'real') list = list.filter(c => c.is_test !== true);
    if (testFilter === 'test') list = list.filter(c => c.is_test === true);
    // Favourites is an independent view filter — it stacks on top of the data
    // view (All / Real / Test), search, group and filters.
    if (favOnly) list = list.filter(c => c.is_favourite === true);
    if (group === 'all') return list;
    const sg = SMART_GROUPS.find(g => g.key === group);
    if (sg) return list.filter(c => sg.test(c._stats, c));
    const cg = customGroups.find(g => g.id === group);
    if (cg) return list.filter(c => (cg.clientIds || []).includes(c.id));
    return list;
  }, [enriched, group, customGroups, testFilter, favOnly]);

  const filtered = useMemo(() => {
    let list = grouped;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(c => [c.client_name, c.phone, c.email].some(v => (v || '').toLowerCase().includes(q)));
    list = list.filter(c => matchFilters(c, c._stats, filters));
    const sv = (c) => {
      const k = sort.key;
      if (k === 'client') return (c.client_name || '').toLowerCase();
      if (k === 'frequency') return frequencyDisplay(c);
      if (k === 'availability_type') return availabilityTypeDisplay(c);
      if (k === 'status') return STATUS_ORDER[c._stats.status] ?? 9;
      if (k === 'last_visit') return c._stats.lastVisit ? c._stats.lastVisit.getTime() : 0;
      if (k === 'visits') return c._stats.visits;
      if (k === 'first_visit') return c._stats.firstVisit ? c._stats.firstVisit.getTime() : 0;
      if (k === 'created') return c.created_date ? new Date(c.created_date).getTime() : 0;
      if (k === 'avg_spend') return c._stats.avgSpend;
      if (k === 'lifetime_spend') return c._stats.lifetimeSpend;
      return 0;
    };
    return [...list].sort((a, b) => { const av = sv(a), bv = sv(b); const r = av < bv ? -1 : av > bv ? 1 : 0; return sort.dir === 'asc' ? r : -r; });
  }, [grouped, search, filters, sort]);

  const activeFilterCount = countActiveFilters(filters);
  const profileClient = clients.find(c => c.id === profileId) || null;

  const toggleSort = (key) => { if (!SORTABLE.has(key)) return; setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }); };
  const toggleRow = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = filtered.length > 0 && filtered.every(c => selectedIds.has(c.id));
  const someSelected = filtered.some(c => selectedIds.has(c.id)) && !allSelected;
  const toggleAll = () => setSelectedIds(prev => { const n = new Set(prev); if (filtered.every(c => n.has(c.id))) filtered.forEach(c => n.delete(c.id)); else filtered.forEach(c => n.add(c.id)); return n; });
  const clearSelection = () => setSelectedIds(new Set());
  const selectedList = useMemo(() => enriched.filter(c => selectedIds.has(c.id)), [enriched, selectedIds]);

  const run = async (fn, okMsg) => {
    try { setBusy(true); await fn(); await load(); if (okMsg) toast({ title: okMsg }); }
    catch (e) { toast({ title: 'Something went wrong. Please try again.', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const bulkUpdate = (ids, patch) => base44.entities.ReminderClient.bulkUpdate([...ids].map(id => ({ id, ...patch })));

  const bulkPause = () => run(() => bulkUpdate(selectedIds, { is_paused: true }), 'Clients paused');
  const bulkResume = () => run(() => bulkUpdate(selectedIds, { is_paused: false }), 'Clients resumed');
  const bulkArchive = () => run(() => bulkUpdate(selectedIds, { archived: true }), 'Clients archived');
  const bulkAddRecurring = () => run(() => bulkUpdate(selectedIds, { recurring_enabled: true }), 'Added to recurring bookings');
  const bulkRemoveRecurring = () => run(() => bulkUpdate(selectedIds, { recurring_enabled: false }), 'Removed from recurring bookings');
  const openDelete = () => { setDeleteIds([...selectedIds]); setDeleteOpen(true); };
  // The backend reports which clients it deleted and which are protected, so the
  // table updates immediately without a page refresh.
  const handleDeleted = ({ deletedIds, blocked }) => {
    const gone = new Set(deletedIds);
    setClients(prev => prev.filter(c => !gone.has(c.id)));
    clearSelection();
    toast({ title: `${deletedIds.length} ${deletedIds.length === 1 ? 'client' : 'clients'} deleted` });
    if (!blocked || blocked.length === 0) setDeleteOpen(false);
  };
  // One-click Favourite. The star flips instantly; the client record is the single
  // source of truth, and the star reverts if the save fails.
  const toggleFavourite = async (client) => {
    const next = client.is_favourite !== true;
    setClients(prev => prev.map(c => c.id === client.id ? { ...c, is_favourite: next } : c));
    try {
      await base44.entities.ReminderClient.update(client.id, { is_favourite: next });
      toast({ title: next ? 'Added to Favourites' : 'Removed from Favourites' });
    } catch {
      setClients(prev => prev.map(c => c.id === client.id ? { ...c, is_favourite: !next } : c));
      toast({ title: 'Could not update favourite. Please try again.', variant: 'destructive' });
    }
  };

  const bulkChangeFrequency = async () => {
    const f = window.prompt(`Change recurring frequency for ${selectedIds.size} clients to:`, 'Monthly');
    if (!f || !FREQUENCY_OPTIONS.includes(f)) { if (f) toast({ title: 'Invalid frequency', variant: 'destructive' }); return; }
    await run(() => bulkUpdate(selectedIds, { recurring_enabled: true, recurring_frequency: f, frequency: f, cadence_source: 'manual' }), 'Recurring frequency updated');
  };
  const bulkChangeAvailability = async () => {
    const a = window.prompt(`Change availability type for ${selectedIds.size} clients to (Fixed Time / Fixed Window / Flexible):`, 'Flexible');
    if (!a || !CATEGORY_OPTIONS.includes(a)) { if (a) toast({ title: 'Invalid availability type', variant: 'destructive' }); return; }
    await run(() => bulkUpdate(selectedIds, { scheduling_category: a }), 'Availability type updated');
  };
  const bulkAddTag = async () => {
    const t = window.prompt(`Add tag to ${selectedIds.size} clients:`);
    if (!t || !t.trim()) return;
    const tag = t.trim();
    const updates = selectedList.map(c => ({ id: c.id, manual_tags: [...new Set([...(c.manual_tags || []), tag])] }));
    await run(() => base44.entities.ReminderClient.bulkUpdate(updates), 'Tag added');
  };
  const bulkRemoveTag = async () => {
    const t = window.prompt(`Remove tag from ${selectedIds.size} clients:`);
    if (!t || !t.trim()) return;
    const tag = t.trim();
    const updates = selectedList.map(c => ({ id: c.id, manual_tags: (c.manual_tags || []).filter(x => x !== tag) }));
    await run(() => base44.entities.ReminderClient.bulkUpdate(updates), 'Tag removed');
  };

  const createGroup = (name) => { const g = { id: 'g' + Date.now(), name, clientIds: [...selectedIds] }; setCustomGroups(prev => { const next = [...prev, g]; saveGroups(next); return next; }); toast({ title: 'Group created' }); };
  const renameGroup = (g) => { const name = window.prompt('Rename group:', g.name); if (!name || !name.trim()) return; setCustomGroups(prev => { const next = prev.map(x => x.id === g.id ? { ...x, name: name.trim() } : x); saveGroups(next); return next; }); };
  const deleteGroup = (g) => { if (!window.confirm(`Delete group "${g.name}"?`)) return; setCustomGroups(prev => { const next = prev.filter(x => x.id !== g.id); saveGroups(next); return next; }); if (group === g.id) setGroup('all'); };
  const bulkAddToGroup = (gid) => { setCustomGroups(prev => { const next = prev.map(g => g.id === gid ? { ...g, clientIds: [...new Set([...(g.clientIds || []), ...selectedIds])] } : g); saveGroups(next); return next; }); toast({ title: 'Added to group' }); };
  const bulkRemoveFromGroup = (gid) => { setCustomGroups(prev => { const next = prev.map(g => g.id === gid ? { ...g, clientIds: (g.clientIds || []).filter(id => !selectedIds.has(id)) } : g); saveGroups(next); return next; }); toast({ title: 'Removed from group' }); };

  const openAdd = () => { setIsNew(true); setEditFor({}); };
  const openEdit = (c) => { setIsNew(false); setEditFor(c); };
  const handleSave = async (payload) => {
    const phoneNorm = normalisePhone(payload.phone);
    const payloadNorm = { ...payload, phone: phoneNorm };
    if (isNew) {
      // Matched by exact phone or email on the server, inside the same test universe.
      const { updated } = await createAdminClients([payloadNorm], { matchExisting: true });
      if (updated.length) { await load(); setEditFor(null); toast({ title: 'Updated existing client', description: 'Matched by phone or email — no duplicate created' }); return; }
    } else { await base44.entities.ReminderClient.update(editFor.id, payloadNorm); }
    await load(); setEditFor(null);
    toast({ title: isNew ? 'Client added' : 'Client updated' });
  };

  // One server call: matched by client id, audited, all-or-nothing. A refusal comes back readable.
  const confirmMerge = async () => {
    const { keep, dup } = mergeAsk;
    setBusy(true);
    try {
      const r = await mergeClients(keep.id, dup.id);
      await load();
      const left = r.bookings_without_client_id_left_alone;
      toast({ title: 'Duplicate merged', description: `${r.bookings_moved} booking${r.bookings_moved === 1 ? '' : 's'} moved.${left ? ` ${left} with the same name but no client link were left alone.` : ''}` });
    } catch (e) {
      toast({ title: 'Merge not done', description: e.message, variant: 'destructive' });
    } finally {
      setMergeAsk(null);
      setBusy(false);
    }
  };

  const onAction = async (action, client, extra) => {
    if (action === 'favourite') return toggleFavourite(client);
    if (action === 'book') { navigate(`/admin/schedule?client=${encodeURIComponent(client.client_name)}`); return; }
    if (action === 'message') { navigate('/admin/messages'); return; }
    if (action === 'pause') return run(() => base44.entities.ReminderClient.update(client.id, { is_paused: true }), 'Client paused');
    if (action === 'resume') return run(() => base44.entities.ReminderClient.update(client.id, { is_paused: false }), 'Client resumed');
    if (action === 'addRecurring') return run(() => base44.entities.ReminderClient.update(client.id, { recurring_enabled: true }), 'Added to recurring reminders');
    if (action === 'removeRecurring') return run(() => base44.entities.ReminderClient.update(client.id, { recurring_enabled: false }), 'Removed from recurring reminders');
    if (action === 'addNote') { const text = (extra || '').trim(); if (!text) return; const merged = client.notes ? `${client.notes}\n${text}` : text; return run(() => base44.entities.ReminderClient.update(client.id, { notes: merged }), 'Note added'); }
    if (action === 'addTag') { const tag = (extra || '').trim(); if (!tag) return; return run(() => base44.entities.ReminderClient.update(client.id, { manual_tags: [...new Set([...(client.manual_tags || []), tag])] }), 'Tag added'); }
    if (action === 'removeTag') { const tag = (extra || '').trim(); if (!tag) return; return run(() => base44.entities.ReminderClient.update(client.id, { manual_tags: (client.manual_tags || []).filter(t => t !== tag) }), 'Tag removed'); }
    if (action === 'merge') { if (!extra) return; setMergeAsk({ keep: client, dup: extra }); return; }
    if (action === 'delete') { if (!window.confirm(`Delete ${client.client_name}?`)) return; return run(async () => { await base44.entities.ReminderClient.delete(client.id); setProfileId(null); }, 'Client deleted'); }
  };

  // CSV
  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const buildCsv = (headers, rows) => [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
  const download = (name, csv) => { const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };

  const colValue = (c, key) => {
    const s = c._stats;
    if (key === 'client') return c.client_name;
    if (key === 'contact') return c.phone || '';
    if (key === 'frequency') return frequencyDisplay(c);
    if (key === 'availability_type') return availabilityTypeDisplay(c);
    if (key === 'status') return s.status;
    if (key === 'last_visit') return s.lastVisit ? formatVisitDate(s.lastVisit) : '';
    if (key === 'visits') return s.visits;
    if (key === 'first_visit') return s.firstVisit ? formatVisitDate(s.firstVisit) : '';
    if (key === 'created') return c.created_date ? formatVisitDate(c.created_date) : '';
    if (key === 'avg_spend') return s.avgSpend.toFixed(2);
    if (key === 'lifetime_spend') return s.lifetimeSpend.toFixed(2);
    if (key === 'tags') return (c.manual_tags || []).join('; ');
    return '';
  };
  const scopeList = (scope) => {
    if (scope === 'all') return enriched;
    if (scope === 'filtered') return filtered;
    if (scope === 'selected') return selectedList;
    if (scope === 'group') return grouped;
    if (scope === 'inactive') return enriched.filter(c => c._stats.status === 'Inactive');
    if (scope === 'recurring') return enriched.filter(c => c._stats.recurring_enabled);
    if (scope === 'weekly') return enriched.filter(c => c.frequency === 'Weekly');
    if (scope === 'flexible') return enriched.filter(c => availabilityTypeDisplay(c) === 'Flexible');
    if (scope === 'fixed_time') return enriched.filter(c => availabilityTypeDisplay(c) === 'Fixed Time');
    if (scope === 'fixed_window') return enriched.filter(c => availabilityTypeDisplay(c) === 'Fixed Window');
    return enriched;
  };
  const handleExport = (scope, cols) => {
    const list = scopeList(scope);
    const headers = cols.map(k => ALL_COLUMNS.find(c => c.key === k)?.label || k);
    const rows = list.map(c => cols.map(k => colValue(c, k)));
    download('clients.csv', buildCsv(headers, rows));
    setExportOpen(false);
    toast({ title: `Exported ${list.length} clients` });
  };
  const handleExportNotes = () => {
    const headers = ['Client name', 'Phone', 'Email', 'Note', 'Note date', 'Created by'];
    const rows = enriched.filter(c => c.notes).map(c => [c.client_name, c.phone, c.email, c.notes, c.updated_date ? formatVisitDate(c.updated_date) : '', c.created_by_id || '']);
    if (!rows.length) { toast({ title: 'No client notes to export' }); return; }
    download('client_notes.csv', buildCsv(headers, rows));
  };

  const handleImportConfirm = async ({ toCreate, toUpdate, skipped }) => {
    try {
      if (toCreate.length) await createAdminClients(toCreate);
      if (toUpdate.length) await base44.entities.ReminderClient.bulkUpdate(toUpdate.map(u => ({ id: u.id, ...u.patch })));
      await load();
      toast({ title: `${toCreate.length} clients imported · ${toUpdate.length} updated · ${skipped || 0} skipped` });
    } catch (e) { toast({ title: 'Import failed. Please try again.', variant: 'destructive' }); }
  };

  const colLabel = (key) => ALL_COLUMNS.find(c => c.key === key)?.label || key;
  const currentGroupName = customGroups.find(g => g.id === group)?.name || '';
  const countContext = (() => {
    if (selectedIds.size > 0) return `${selectedIds.size} selected`;
    const total = enriched.length;
    if (search.trim()) return `${filtered.length} matching clients`;
    if (group === 'all' && activeFilterCount === 0) return `${total} clients in All Clients`;
    const pct = total ? Math.round(filtered.length / total * 100) : 0;
    return `${filtered.length} clients · ${pct}% of your client base`;
  })();

  return (
    <div className="p-5 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">Clients</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..." className="pl-8 w-full sm:w-64 bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400" />
          </div>
          <Button onClick={openAdd} className="bg-zinc-900 hover:bg-zinc-800 text-white"><UserPlus className="w-4 h-4" /> Add Client</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <GroupSelector selected={group} onSelect={setGroup} customGroups={customGroups} onCreate={createGroup} onRename={renameGroup} onDelete={deleteGroup} counts={smartCounts} />
        <div className="inline-flex items-center h-9 rounded-lg border border-zinc-200 bg-white overflow-hidden">
          {[['all', 'All'], ['real', 'Real Clients'], ['test', 'Test Clients']].map(([key, label]) => (
            <button key={key} onClick={() => setTestFilter(key)} className={cn('h-full px-3 text-sm', testFilter === key ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-50')}>{label}</button>
          ))}
        </div>
        <button
          onClick={() => setFavOnly(v => !v)}
          className={cn('inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm', favOnly ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50')}
        >
          <Star className={cn('w-3.5 h-3.5', favOnly ? 'fill-amber-400 text-amber-400' : 'text-zinc-400')} /> Favourites
        </button>
        <button
          onClick={() => setVipOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
        >
          <Crown className="w-3.5 h-3.5 text-amber-500" /> VIP Clients
        </button>
        {testFilter === 'test' && (
          <button onClick={() => setCleanupOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-violet-200 bg-violet-50 text-sm text-violet-700 hover:bg-violet-100">
            <Trash2 className="w-3.5 h-3.5" /> Delete Test Data
          </button>
        )}
        <ImportExportMenu onImport={() => setImportOpen(true)} onExport={() => setExportOpen(true)} onExportNotes={handleExportNotes} selectedCount={selectedIds.size} />
        <button onClick={() => setFilterOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50">
          <Filter className="w-4 h-4" /> Filters {activeFilterCount > 0 && <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold">{activeFilterCount}</span>}
        </button>
        <SortDropdown sort={sort} onChange={setSort} />
        <ColumnSelector visible={visibleCols} onChange={setVisibleCols} />
        <button onClick={() => setFilters({ ...EMPTY_FILTERS, status: ['Inactive'] })} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-orange-200 bg-orange-50 text-sm text-orange-700 hover:bg-orange-100">
          <AlertTriangle className="w-3.5 h-3.5" /> Inactive clients
        </button>
        <div className="ml-auto text-xs text-zinc-500">{countContext}</div>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {filters.status?.map(s => <Chip key={'s' + s} label={s} onRemove={() => setFilters(f => ({ ...f, status: f.status.filter(x => x !== s) }))} />)}
          {filters.frequency?.map(s => <Chip key={'f' + s} label={s} onRemove={() => setFilters(f => ({ ...f, frequency: f.frequency.filter(x => x !== s) }))} />)}
          {filters.availability?.map(s => <Chip key={'a' + s} label={s} onRemove={() => setFilters(f => ({ ...f, availability: f.availability.filter(x => x !== s) }))} />)}
          {filters.recurring !== 'any' && <Chip label={filters.recurring === 'enabled' ? 'Recurring enabled' : 'Recurring disabled'} onRemove={() => setFilters(f => ({ ...f, recurring: 'any' }))} />}
          {filters.recurring_paused && <Chip label="Recurring paused" onRemove={() => setFilters(f => ({ ...f, recurring_paused: false }))} />}
          {filters.weekly_confirmation && <Chip label="Weekly confirmation" onRemove={() => setFilters(f => ({ ...f, weekly_confirmation: false }))} />}
          {filters.no_visits && <Chip label="No visits" onRemove={() => setFilters(f => ({ ...f, no_visits: false }))} />}
          {filters.last_visit_35 && <Chip label="Last visit >35 days" onRemove={() => setFilters(f => ({ ...f, last_visit_35: false }))} />}
          {filters.visit_min && <Chip label={`≥ ${filters.visit_min} visits`} onRemove={() => setFilters(f => ({ ...f, visit_min: '' }))} />}
          {filters.last_visit_from && <Chip label={`From ${filters.last_visit_from}`} onRemove={() => setFilters(f => ({ ...f, last_visit_from: '' }))} />}
          {filters.last_visit_to && <Chip label={`To ${filters.last_visit_to}`} onRemove={() => setFilters(f => ({ ...f, last_visit_to: '' }))} />}
          {filters.first_visit_from && <Chip label={`First from ${filters.first_visit_from}`} onRemove={() => setFilters(f => ({ ...f, first_visit_from: '' }))} />}
          {filters.first_visit_to && <Chip label={`First to ${filters.first_visit_to}`} onRemove={() => setFilters(f => ({ ...f, first_visit_to: '' }))} />}
          {filters.created_from && <Chip label={`Created from ${filters.created_from}`} onRemove={() => setFilters(f => ({ ...f, created_from: '' }))} />}
          {filters.created_to && <Chip label={`Created to ${filters.created_to}`} onRemove={() => setFilters(f => ({ ...f, created_to: '' }))} />}
          {filters.has_phone && <Chip label="Has phone" onRemove={() => setFilters(f => ({ ...f, has_phone: false }))} />}
          {filters.has_email && <Chip label="Has email" onRemove={() => setFilters(f => ({ ...f, has_email: false }))} />}
          {filters.has_address && <Chip label="Has address" onRemove={() => setFilters(f => ({ ...f, has_address: false }))} />}
          {filters.has_notes && <Chip label="Has notes" onRemove={() => setFilters(f => ({ ...f, has_notes: false }))} />}
          {filters.has_manual_tags && <Chip label="Has tags" onRemove={() => setFilters(f => ({ ...f, has_manual_tags: false }))} />}
          {filters.suburb?.map(s => <Chip key={'sub' + s} label={s} onRemove={() => setFilters(f => ({ ...f, suburb: f.suburb.filter(x => x !== s) }))} />)}
          {filters.postcode?.map(s => <Chip key={'pc' + s} label={s} onRemove={() => setFilters(f => ({ ...f, postcode: f.postcode.filter(x => x !== s) }))} />)}
          {filters.service?.map(s => <Chip key={'svc' + s} label={s} onRemove={() => setFilters(f => ({ ...f, service: f.service.filter(x => x !== s) }))} />)}
          {filters.avg_min && <Chip label={`Avg ≥ $${filters.avg_min}`} onRemove={() => setFilters(f => ({ ...f, avg_min: '' }))} />}
          {filters.lt_min && <Chip label={`Lifetime ≥ $${filters.lt_min}`} onRemove={() => setFilters(f => ({ ...f, lt_min: '' }))} />}
          {filters.tx_min && <Chip label={`Txns ≥ ${filters.tx_min}`} onRemove={() => setFilters(f => ({ ...f, tx_min: '' }))} />}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-zinc-100">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 text-white text-xs font-medium">{selectedIds.size} selected</span>
          <BulkBtn icon={Pause} label="Pause" onClick={bulkPause} />
          <BulkBtn icon={Play} label="Resume" onClick={bulkResume} />
          <BulkBtn icon={Download} label="Export" onClick={() => setExportOpen(true)} />
          <div className="relative">
            <button onClick={() => setMoreOpen(v => !v)} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-white border border-zinc-200 text-sm text-zinc-700 hover:bg-zinc-50"><MoreHorizontal className="w-3.5 h-3.5" /> More</button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                <div className="absolute left-0 mt-1 z-40 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl py-1 max-h-[60vh] overflow-y-auto">
                  <MoreItem icon={Tag} label="Add tag" onClick={() => { setMoreOpen(false); bulkAddTag(); }} />
                  <MoreItem icon={Tag} label="Remove tag" onClick={() => { setMoreOpen(false); bulkRemoveTag(); }} />
                  <MoreItem icon={Repeat} label="Enable recurring booking" onClick={() => { setMoreOpen(false); bulkAddRecurring(); }} />
                  <MoreItem icon={Repeat} label="Disable recurring booking" onClick={() => { setMoreOpen(false); bulkRemoveRecurring(); }} />
                  <MoreItem icon={Repeat} label="Change recurring frequency" onClick={() => { setMoreOpen(false); bulkChangeFrequency(); }} />
                  <MoreItem icon={Repeat} label="Change availability type" onClick={() => { setMoreOpen(false); bulkChangeAvailability(); }} />
                  {customGroups.length > 0 && <p className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mt-1">Add to group</p>}
                  {customGroups.map(g => <MoreItem key={g.id} icon={FolderPlus} label={g.name} onClick={() => { setMoreOpen(false); bulkAddToGroup(g.id); }} />)}
                  {customGroups.length > 0 && <p className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mt-1">Remove from group</p>}
                  {customGroups.map(g => <MoreItem key={'r' + g.id} icon={FolderMinus} label={g.name} onClick={() => { setMoreOpen(false); bulkRemoveFromGroup(g.id); }} />)}
                  <div className="border-t border-zinc-100 my-1" />
                  <MoreItem icon={Archive} label="Archive" onClick={() => { setMoreOpen(false); bulkArchive(); }} />
                </div>
              </>
            )}
          </div>
          <button onClick={openDelete} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-red-600 border border-red-600 text-white text-sm font-semibold hover:bg-red-700">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <button onClick={clearSelection} className="text-sm text-indigo-600 hover:text-indigo-700 ml-1">Clear selection</button>
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        {loading ? (
          <LoadingState rows={6} />
        ) : loadError ? (
          <ErrorState
            title="Couldn't load clients"
            description="Please try again."
            onRetry={load}
          />
        ) : filtered.length === 0 ? (
          clients.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No clients yet"
              description="Clients will appear here once they book or are added."
              actionLabel="Add Client"
              onAction={openAdd}
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="No clients match these filters"
              description="Try clearing filters or adjusting your search."
              filtered
              actionLabel="Clear Filters"
              onAction={() => { setFilters(EMPTY_FILTERS); setSearch(''); setGroup('all'); setFavOnly(false); }}
            />
          )
        ) : (
          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-20">
                <tr className="bg-zinc-50 text-zinc-500 border-b border-zinc-200">
                  <th className="sticky left-0 bg-zinc-50 px-3 py-3 w-10 z-30">
                    <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected; }} onChange={toggleAll} className="w-4 h-4 rounded border-zinc-300 text-indigo-600" />
                  </th>
                  {visibleCols.map(key => (
                    <th key={key} onClick={() => toggleSort(key)} className={cn('px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider whitespace-nowrap', SORTABLE.has(key) && 'cursor-pointer hover:text-zinc-700')}>
                      <span className="inline-flex items-center gap-1">{colLabel(key)}{sort.key === key && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.length === 0 && <tr><td colSpan={visibleCols.length + 1} className="px-4 py-12 text-center text-zinc-400">No clients found</td></tr>}
                {filtered.map(c => {
                  const s = c._stats;
                  const selected = selectedIds.has(c.id);
                  const tags = c.manual_tags || [];
                  return (
                    <tr key={c.id} onClick={() => setProfileId(c.id)} className="hover:bg-zinc-50/70 cursor-pointer">
                      <td onClick={(e) => { e.stopPropagation(); toggleRow(c.id); }} className={cn('sticky left-0 px-3 py-3 z-10', selected ? 'bg-zinc-50' : 'bg-white')}>
                        <input type="checkbox" checked={selected} onChange={() => toggleRow(c.id)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded border-zinc-300 text-indigo-600" />
                      </td>
                      {visibleCols.includes('client') && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5 min-w-[180px]">
                            <FavouriteStar isFavourite={c.is_favourite === true} onToggle={() => toggleFavourite(c)} name={c.client_name} />
                            <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold shrink-0">{initials(c.client_name)}</div>
                            <div className="leading-tight min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium text-zinc-900 truncate">{c.client_name}</p>
                                {c.is_test === true && <StatusBadge tone="test" className="shrink-0">TEST</StatusBadge>}
                              </div>
                              <p className="text-[11px] text-zinc-400 truncate">{c.usual_service || '—'}</p>
                            </div>
                          </div>
                        </td>
                      )}
                      {visibleCols.includes('contact') && (
                        <td className="px-4 py-3">
                          <div className="text-[13px] text-zinc-700 whitespace-nowrap">{c.phone ? formatPhoneAu(c.phone) : '—'}</div>
                          <div className="text-[11px] text-zinc-400 whitespace-nowrap">{c.email || ''}</div>
                        </td>
                      )}
                      {visibleCols.includes('frequency') && <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">{frequencyDisplay(c)}</td>}
                      {visibleCols.includes('availability_type') && <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">{availabilityTypeDisplay(c)}</td>}
                      {visibleCols.includes('status') && <td className="px-4 py-3"><span className={cn('inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium', STATUS_STYLES[s.status])}>{s.status}</span></td>}
                      {visibleCols.includes('last_visit') && <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{relativeVisit(s.lastVisit)}</td>}
                      {visibleCols.includes('visits') && <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">{s.visits} {s.visits === 1 ? 'visit' : 'visits'}</td>}
                      {visibleCols.includes('first_visit') && <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{s.firstVisit ? formatVisitDate(s.firstVisit) : '—'}</td>}
                      {visibleCols.includes('created') && <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{c.created_date ? formatVisitDate(c.created_date) : '—'}</td>}
                      {visibleCols.includes('avg_spend') && <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">${s.avgSpend.toFixed(2)}</td>}
                      {visibleCols.includes('lifetime_spend') && <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">${s.lifetimeSpend.toFixed(2)}</td>}
                      {visibleCols.includes('tags') && (
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {tags.slice(0, 2).map(t => <span key={t} className="inline-flex px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 text-[10px] font-medium">{t}</span>)}
                            {tags.length > 2 && <span className="text-[10px] text-zinc-400">+{tags.length - 2}</span>}
                            {tags.length === 0 && <span className="text-[11px] text-zinc-300">—</span>}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-zinc-100 text-xs text-zinc-500">{countContext}</div>
      </div>

      <FilterPanel open={filterOpen} filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} onClear={() => setFilters(EMPTY_FILTERS)} suburbs={suburbs} postcodes={postcodes} services={services} />
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} existingClients={clients} onConfirm={handleImportConfirm} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} onExport={handleExport} hasSelection={selectedIds.size > 0} hasGroup={group !== 'all' && !SMART_GROUPS.some(g => g.key === group)} groupName={currentGroupName} />

      {profileClient && <ClientProfileDrawer client={profileClient} bookings={bookings} allClients={clients} onClose={() => setProfileId(null)} onEdit={() => openEdit(profileClient)} onAction={onAction} busy={busy} />}
      {editFor && <ClientDrawer client={editFor} isNew={isNew} onClose={() => setEditFor(null)} onSave={handleSave} />}
      {cleanupOpen && <TestDataCleanupModal onClose={() => setCleanupOpen(false)} onDone={load} />}
      {deleteOpen && <DeleteClientsModal ids={deleteIds} onClose={() => setDeleteOpen(false)} onDeleted={handleDeleted} />}
      <MergeClientsDialog ask={mergeAsk} busy={busy} onCancel={() => setMergeAsk(null)} onConfirm={confirmMerge} />

      <Dialog open={vipOpen} onOpenChange={(open) => { setVipOpen(open); if (!open) navigate('/admin/clients', { replace: true }); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>VIP Clients</DialogTitle>
            <DialogDescription>Recurring appointments held for the same day and time.</DialogDescription>
          </DialogHeader>
          <VipClientsPanel />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Chip({ label, onRemove }) {
  return (<span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">{label}<button onClick={onRemove} className="hover:text-indigo-900"><X className="w-3 h-3" /></button></span>);
}
function BulkBtn({ icon: Icon, label, onClick }) {
  return (<button onClick={onClick} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-white border border-zinc-200 text-sm text-zinc-700 hover:bg-zinc-50"><Icon className="w-3.5 h-3.5" /> {label}</button>);
}
function MoreItem({ icon: Icon, label, onClick, danger }) {
  return (<button onClick={onClick} className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50', danger ? 'text-red-600' : 'text-zinc-700')}><Icon className="w-3.5 h-3.5" /> {label}</button>);
}