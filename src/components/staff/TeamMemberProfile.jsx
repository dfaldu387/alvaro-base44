/**
 * TeamMemberProfile — right column: profile header, tabs, and tab content.
 * Tabs: Overview, Appointments, Services, Permissions, Notifications.
 * Focus is on the Appointments tab (working hours + special hours + notes).
 */
import React, { useState, useEffect } from 'react';
import { MoreHorizontal, Check, Info, ArrowLeft, Loader2, Mail, X, AlertTriangle, Trash2, UserX } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { DEFAULT_WORKING_HOURS } from '@/lib/businessHoursUtils';
import { cn } from '@/lib/utils';
import WorkingHoursEditor from '@/components/staff/WorkingHoursEditor';
import SpecialHoursEditor from '@/components/staff/SpecialHoursEditor';
import ExtendedHoursCard from '@/components/staff/ExtendedHoursCard';
import AfterHoursCard from '@/components/staff/AfterHoursCard';
import DailyAvailabilityPreview from '@/components/staff/DailyAvailabilityPreview';
import StartLocationCard from '@/components/staff/StartLocationCard';
import StatusBadge from '@/components/admin/ui/StatusBadge';
import AdminCard from '@/components/admin/ui/AdminCard';

const TABS = ['Overview', 'Appointments', 'Services', 'Permissions', 'Notifications'];

const AVATAR_COLORS = ['#5E42F3', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#8B5CF6'];

export default function TeamMemberProfile({ member, onSave, onBack, onSendInvite, onClose, onDirtyChange, onRemove }) {
  const [activeTab, setActiveTab] = useState('Appointments');
  const [form, setForm] = useState({});
  const [services, setServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [saved, setSaved] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // null | 'delete'
  const [hasHistory, setHasHistory] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const { toast } = useToast();

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);

  useEffect(() => {
    base44.entities.Service.list('sort_order', 50).then(setServices).catch(() => {});
  }, []);

  useEffect(() => {
    if (member) {
      setDirty(false);
      setConfirmAction(null);
      setHasHistory(false);
      base44.entities.BookingRequest.filter({ team_member_id: member.id, is_test: { $ne: true } })
        .then(reqs => setHasHistory(reqs && reqs.length > 0))
        .catch(() => setHasHistory(false));
      setForm({
        name: member.name || '',
        initials: member.initials || (member.name?.slice(0, 2).toUpperCase() || ''),
        job_title: member.job_title || '',
        role: member.role || 'barber',
        is_bookable: member.is_bookable ?? true,
        status: member.status || 'Active',
        avatar_color: member.avatar_color || '#5E42F3',
        working_hours: member.working_hours?.length ? member.working_hours : DEFAULT_WORKING_HOURS,
        special_hours: member.special_hours || [],
        allow_early_extension: member.allow_early_extension ?? true,
        early_extension_minutes: member.early_extension_minutes ?? 30,
        allow_late_extension: member.allow_late_extension ?? true,
        late_extension_minutes: member.late_extension_minutes ?? 60,
        after_hours_manual_approval: member.after_hours_manual_approval ?? true,
        after_hours_allow_groups: member.after_hours_allow_groups ?? true,
        after_hours_allow_priority: member.after_hours_allow_priority ?? true,
        start_location_address: member.start_location_address || '',
        start_location_lat: member.start_location_lat ?? null,
        start_location_lng: member.start_location_lng ?? null,
        notes: member.notes || '',
        assigned_service_ids: member.assigned_service_ids || [],
        notification_email_bookings: member.notification_email_bookings ?? true,
        notification_sms_bookings: member.notification_sms_bookings ?? false,
        alternate_email: member.alternate_email || '',
        alternate_phone: member.alternate_phone || '',
        email: member.email || '',
        phone: member.phone || '',
        invite_status: member.invite_status || 'not_invited',
        invite_expires_at: member.invite_expires_at || null,
      });
    }
  }, [member?.id]);

  if (!member) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
        Select a team member to view their profile
      </div>
    );
  }

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };
  const setMany = (patch) => { setForm(p => ({ ...p, ...patch })); setDirty(true); };

  const handleSave = async () => {
    setSaving(true);
    await onSave(member.id, form);
    setSaving(false);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  // The start location saves on its own, so a barber's route origin can be set
  // (and picked up by Route Flow) without committing unrelated edits.
  const handleSaveLocation = async () => {
    if (savingLocation) return;
    setSavingLocation(true);
    try {
      await onSave(member.id, {
        start_location_address: form.start_location_address || '',
        start_location_lat: form.start_location_lat ?? null,
        start_location_lng: form.start_location_lng ?? null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({
        title: 'Start location saved',
        description: 'Route Flow will measure first-leg travel from here.',
      });
    } finally {
      setSavingLocation(false);
    }
  };

  const handleSendInvite = async () => {
    if (!form.email?.trim()) return;
    setInviting(true);
    try {
      const res = await base44.functions.invoke('inviteStaffMember', {
        member_id: member.id,
        name: form.name,
        email: form.email,
        phone: form.phone,
        job_title: form.job_title,
        role: form.role,
        is_bookable: form.is_bookable,
      });
      const updated = res.data?.member;
      if (updated) {
        setForm(p => ({ ...p, invite_status: 'invite_sent', invite_expires_at: updated.invite_expires_at, user_id: updated.user_id }));
        setDirty(false);
        onSave(member.id, { invite_status: 'invite_sent', invite_expires_at: updated.invite_expires_at, user_id: updated.user_id, email: form.email, phone: form.phone });
      }
    } catch (err) {
      // silent — could add error state if needed
    } finally {
      setInviting(false);
    }
  };

  const isInviteExpired = form.invite_status === 'invite_sent' && form.invite_expires_at && new Date(form.invite_expires_at) < new Date();

  const handleToggleStatus = async () => {
    const mode = form.status === 'Active' ? 'deactivate' : 'reactivate';
    try {
      await onRemove(member.id, mode);
      if (mode === 'deactivate') {
        setForm(p => ({ ...p, status: 'Inactive', is_bookable: false, invite_status: 'inactive' }));
      } else {
        setForm(p => ({ ...p, status: 'Active', is_bookable: true, invite_status: member.user_id ? 'active' : form.invite_status }));
      }
    } catch { /* silent */ }
  };

  const handleConfirmDelete = async () => {
    setRemoving(true);
    setErrorMsg(null);
    try {
      await onRemove(member.id, 'delete');
      setConfirmAction(null);
      toast({ title: 'Team member deleted' });
    } catch (err) {
      setErrorMsg(err?.data?.error || err?.message || 'Failed to delete team member.');
    } finally {
      setRemoving(false);
    }
  };

  const toggleService = (serviceId) => {
    setForm(p => ({
      ...p,
      assigned_service_ids: p.assigned_service_ids.includes(serviceId)
        ? p.assigned_service_ids.filter(id => id !== serviceId)
        : [...p.assigned_service_ids, serviceId],
    }));
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-zinc-200">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 mb-3 lg:hidden">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to list
          </button>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: form.avatar_color || '#5E42F3' }}
            >
              {form.initials || form.name?.slice(0, 2).toUpperCase() || '?'}
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900">{form.name || 'Unnamed'}</h2>
              <p className="text-sm text-zinc-500">{form.job_title || 'Barber'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onClose?.()}
              className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
              aria-label="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
            <StatusBadge
              className="whitespace-nowrap"
              tone={form.invite_status === 'active' ? 'success' :
                isInviteExpired ? 'danger' :
                form.invite_status === 'invite_sent' ? 'warning' :
                form.invite_status === 'inactive' ? 'danger' : 'neutral'}
            >
              {form.invite_status === 'active' ? 'Accepted' :
               isInviteExpired ? 'Expired' :
               form.invite_status === 'invite_sent' ? 'Invite sent' :
               form.invite_status === 'inactive' ? 'Inactive' : 'Not invited'}
            </StatusBadge>
            {form.email && member.role !== 'owner' && (
              <button
                onClick={handleSendInvite}
                disabled={inviting || !form.email.trim()}
                className="flex items-center gap-1.5 border border-zinc-200 text-zinc-700 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {inviting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</> : <><Mail className="w-3.5 h-3.5" /> {form.invite_status === 'invite_sent' ? 'Resend' : 'Send Invite'}</>}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 bg-[#5E42F3] hover:bg-[#4F35E0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : saved ? <><Check className="w-4 h-4" /> Saved</> : 'Save changes'}
            </button>
            {member.role !== 'owner' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={handleToggleStatus}
                    className={form.status === 'Active' ? 'text-amber-600 focus:text-amber-600 focus:bg-amber-50' : ''}
                  >
                    <UserX className="w-4 h-4 mr-2" />
                    {form.status === 'Active' ? 'Deactivate Team Member' : 'Reactivate Team Member'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {!hasHistory && (
                    <DropdownMenuItem
                      onClick={() => { setConfirmAction('delete'); setErrorMsg(null); }}
                      className="text-red-600 focus:text-red-600 focus:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Team Member
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-5 mt-4 -mb-4 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab ? 'text-[#5E42F3] border-[#5E42F3]' : 'text-zinc-500 border-transparent hover:text-zinc-800'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {/* ── Overview ── */}
        {activeTab === 'Overview' && (
          <div className="max-w-lg space-y-4">
            <div>
              <label className="text-xs font-semibold text-zinc-700 mb-1 block">Name</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-700 mb-1 block">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="staff@example.com" className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-700 mb-1 block">Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="04xx xxx xxx" className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-700 mb-1 block">Job title</label>
              <input value={form.job_title} onChange={e => set('job_title', e.target.value)} placeholder="e.g. Owner, Barber" className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-700 mb-1 block">Role</label>
              <select value={form.role} onChange={e => set('role', e.target.value)} disabled={member.role === 'owner'} className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                <option value="barber">Barber</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-700 mb-2 block">Calendar colour</label>
              <div className="flex items-center gap-2">
                {AVATAR_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => set('avatar_color', c)}
                    className={cn('w-8 h-8 rounded-full transition-transform', form.avatar_color === c ? 'ring-2 ring-offset-2 ring-zinc-400 scale-110' : 'hover:scale-105')}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-zinc-900">Bookable</p>
                <p className="text-xs text-zinc-500">Available for online booking</p>
              </div>
              <button onClick={() => set('is_bookable', !form.is_bookable)} className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0', form.is_bookable ? 'bg-[#5E42F3]' : 'bg-zinc-300')}>
                <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform', form.is_bookable && 'translate-x-4')} />
              </button>
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-700 mb-1 block">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] cursor-pointer">
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
        )}

        {/* ── Appointments ── */}
        {activeTab === 'Appointments' && (
          <div className="space-y-5">
            {/* Default Start Location — where this barber's day begins */}
            <StartLocationCard
              address={form.start_location_address || ''}
              lat={form.start_location_lat ?? null}
              lng={form.start_location_lng ?? null}
              barberName={form.name}
              onChange={setMany}
              onSave={handleSaveLocation}
              saving={savingLocation}
            />

            {/* Top row: Working Hours (left, wider) + Extended & After Hours (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Working Hours — spans 2 columns */}
              <div className="lg:col-span-2 space-y-4">
                <AdminCard className="p-0 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-100">
                    <div>
                      <h3 className="text-sm font-bold text-zinc-900">Working hours</h3>
                      <p className="text-xs text-zinc-500 mt-0.5">Set the days and times you are available for appointments.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => set('working_hours', form.working_hours?.length ? form.working_hours.map(h => ({ ...h, is_open: !h.is_open })) : DEFAULT_WORKING_HOURS.map(h => ({ ...h, is_open: !h.is_open })))}
                      className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0',
                        form.working_hours?.some(h => h.is_open) ? 'bg-[#5E42F3]' : 'bg-zinc-300')}
                    >
                      <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform',
                        form.working_hours?.some(h => h.is_open) && 'translate-x-4')} />
                    </button>
                  </div>
                  <div className="px-4 py-2">
                    <WorkingHoursEditor
                      workingHours={form.working_hours}
                      onChange={h => set('working_hours', h)}
                    />
                  </div>
                </AdminCard>

                {/* About working hours info card */}
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#5E42F3]/10 flex items-center justify-center shrink-0">
                      <Info className="w-4 h-4 text-[#5E42F3]" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-900 mb-0.5">About working hours</p>
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        Working hours control when each team member is available for bookings. They feed your calendar, booking requests, and online booking availability.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Special hours */}
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 mb-1">Special hours / exceptions</h3>
                  <p className="text-xs text-zinc-500 mb-3">Set different hours for holidays, events or one-off changes.</p>
                  <SpecialHoursEditor
                    specialHours={form.special_hours}
                    onChange={h => set('special_hours', h)}
                  />
                </div>
              </div>

              {/* Right column: Extended Hours + After Hours */}
              <div className="space-y-4">
                <ExtendedHoursCard
                  allowEarly={form.allow_early_extension}
                  earlyMins={form.early_extension_minutes}
                  allowLate={form.allow_late_extension}
                  lateMins={form.late_extension_minutes}
                  onAllowEarly={v => set('allow_early_extension', v)}
                  onEarlyMins={v => set('early_extension_minutes', v)}
                  onAllowLate={v => set('allow_late_extension', v)}
                  onLateMins={v => set('late_extension_minutes', v)}
                />
                <AfterHoursCard
                  manualApproval={form.after_hours_manual_approval}
                  allowGroups={form.after_hours_allow_groups}
                  allowPriority={form.after_hours_allow_priority}
                  onManualApproval={v => set('after_hours_manual_approval', v)}
                  onAllowGroups={v => set('after_hours_allow_groups', v)}
                  onAllowPriority={v => set('after_hours_allow_priority', v)}
                />
              </div>
            </div>

            {/* Daily Availability Preview — full width */}
            <DailyAvailabilityPreview
              workingHours={form.working_hours}
              allowEarlyExtension={form.allow_early_extension}
              earlyExtensionMinutes={form.early_extension_minutes}
              allowLateExtension={form.allow_late_extension}
              lateExtensionMinutes={form.late_extension_minutes}
            />

            {/* Notes */}
            <div>
              <h3 className="text-sm font-bold text-zinc-900 mb-1">Notes (optional)</h3>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value.slice(0, 250))}
                rows={3}
                placeholder="Add any notes about your availability..."
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400 resize-none"
              />
              <p className="text-[11px] text-zinc-400 text-right mt-1">{(form.notes || '').length} / 250 characters</p>
            </div>
          </div>
        )}

        {/* ── Services ── */}
        {activeTab === 'Services' && (
          <div className="max-w-lg">
            <h3 className="text-base font-bold text-zinc-900 mb-1">Assigned services</h3>
            <p className="text-sm text-zinc-500 mb-4">This team member can only be booked for services assigned to them.</p>
            <div className="space-y-2">
              {services.length === 0 ? (
                <p className="text-sm text-zinc-400">No services found. Create services in the Services page first.</p>
              ) : services.map(svc => {
                const checked = form.assigned_service_ids?.includes(svc.id);
                return (
                  <button
                    key={svc.id}
                    onClick={() => toggleService(svc.id)}
                    className={cn('w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left',
                      checked ? 'border-[#5E42F3] bg-[#5E42F3]/5' : 'border-zinc-200 bg-white hover:border-zinc-300')}
                  >
                    <div className={cn('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                      checked ? 'bg-[#5E42F3] border-[#5E42F3]' : 'border-zinc-300')}>
                      {checked && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 truncate">{svc.name}</p>
                      <p className="text-xs text-zinc-500">${svc.price} · {svc.duration_mins} min</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Permissions ── */}
        {activeTab === 'Permissions' && (
          <div className="max-w-lg space-y-4">
            <div>
              <h3 className="text-base font-bold text-zinc-900 mb-1">Role & permissions</h3>
              <p className="text-sm text-zinc-500 mb-4">Control what this team member can access and edit.</p>
            </div>
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">Role</span>
                <span className="text-sm font-semibold text-zinc-900 capitalize">{form.role || 'barber'}</span>
              </div>
              <div className="border-t border-zinc-200 pt-3 space-y-2">
                <PermissionRow label="Edit own working hours" granted={true} />
                <PermissionRow label="View/manage own appointments" granted={true} />
                <PermissionRow label="Edit all team members" granted={form.role === 'owner' || form.role === 'admin'} />
                <PermissionRow label="Edit everyone's working hours" granted={form.role === 'owner' || form.role === 'admin'} />
                <PermissionRow label="Manage services" granted={form.role === 'owner' || form.role === 'admin'} />
                <PermissionRow label="Change permissions" granted={form.role === 'owner'} />
              </div>
            </div>
          </div>
        )}

        {/* ── Notifications ── */}
        {activeTab === 'Notifications' && (
          <div className="max-w-lg space-y-4">
            <div>
              <h3 className="text-base font-bold text-zinc-900 mb-1">Notification preferences</h3>
              <p className="text-sm text-zinc-500 mb-4">Choose how this team member receives booking notifications.</p>
            </div>
            <div className="space-y-2">
              <NotifToggle
                label="Email booking notifications"
                description="Receive an email when a new booking is made"
                value={form.notification_email_bookings}
                onChange={v => set('notification_email_bookings', v)}
              />
              <NotifToggle
                label="SMS booking notifications"
                description="Receive a text message for new bookings (coming soon)"
                value={form.notification_sms_bookings}
                onChange={v => set('notification_sms_bookings', v)}
              />
            </div>
            <div className="border-t border-zinc-200 pt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-zinc-700 mb-1 block">Alternate email (optional)</label>
                <input value={form.alternate_email} onChange={e => set('alternate_email', e.target.value)} placeholder="notifications@example.com" className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-700 mb-1 block">Alternate phone (optional)</label>
                <input value={form.alternate_phone} onChange={e => set('alternate_phone', e.target.value)} placeholder="04xx xxx xxx" className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Confirmation modal ── */}
      {confirmAction === 'delete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !removing && setConfirmAction(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-900">Delete this team member?</h3>
                <p className="text-sm text-zinc-500 mt-1">
                  This will permanently delete this team member record. This action cannot be undone.
                </p>
              </div>
            </div>
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">
                {errorMsg}
              </div>
            )}
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={removing}
                className="flex-1 h-10 border border-zinc-200 text-zinc-700 text-sm font-semibold rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={removing}
                className="flex-1 h-10 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {removing ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</> : 'Delete Team Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionRow({ label, granted }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-600">{label}</span>
      <span className={cn('text-xs font-semibold', granted ? 'text-emerald-600' : 'text-zinc-400')}>
        {granted ? 'Granted' : 'Not granted'}
      </span>
    </div>
  );
}

function NotifToggle({ label, description, value, onChange }) {
  return (
    <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-zinc-900">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <button onClick={() => onChange(!value)} className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0', value ? 'bg-[#5E42F3]' : 'bg-zinc-300')}>
        <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform', value && 'translate-x-4')} />
      </button>
    </div>
  );
}