/**
 * TeamMembers — Staff → Team Members page.
 * Two-column layout: list (left) + profile (right).
 * On mobile: list takes full width; selecting a member shows the profile.
 */
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { DEFAULT_WORKING_HOURS, invalidateTeamMembersCache } from '@/lib/businessHoursUtils';
import { cn } from '@/lib/utils';
import TeamMemberList from '@/components/staff/TeamMemberList';
import TeamMemberProfile from '@/components/staff/TeamMemberProfile';
import CalendarSyncCard from '@/components/staff/CalendarSyncCard';
import InviteStaffModal from '@/components/staff/InviteStaffModal';
import LoadingState from '@/components/states/LoadingState';
import ErrorState from '@/components/states/ErrorState';

export default function TeamMembers() {
  const [members, setMembers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let list = await base44.entities.TeamMember.list('-created_date', 50);
      if (list.length === 0) {
        // Seed a default Owner member
        let ownerName = 'Alvaro';
        try {
          const me = await base44.auth.me();
          if (me?.full_name) ownerName = me.full_name;
        } catch { /* ignore */ }
        const owner = await base44.entities.TeamMember.create({
          name: ownerName,
          initials: ownerName.slice(0, 2).toUpperCase(),
          job_title: 'Owner',
          role: 'owner',
          is_bookable: true,
          status: 'Active',
          avatar_color: '#5E42F3',
          working_hours: DEFAULT_WORKING_HOURS,
          special_hours: [],
          assigned_service_ids: [],
          notification_email_bookings: true,
        });
        list = [owner];
      }
      setMembers(list);
      if (list.length > 0) setSelectedId(list[0].id);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  };

  const handleAdd = () => {
    setShowInviteModal(true);
  };

  const handleInvited = (member) => {
    invalidateTeamMembersCache();
    setMembers(prev => [member, ...prev]);
    setSelectedId(member.id);
    setShowInviteModal(false);
    setSearch('');
  };

  const handleSendInvite = async (member) => {
    const res = await base44.functions.invoke('inviteStaffMember', {
      member_id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone,
      job_title: member.job_title,
      role: member.role,
      is_bookable: member.is_bookable,
    });
    return res.data.member;
  };

  const handleCloseRequest = () => {
    if (dirty) {
      setShowCloseConfirm(true);
    } else {
      setSelectedId(null);
    }
  };

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && selectedId && !showCloseConfirm) {
        handleCloseRequest();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedId, dirty, showCloseConfirm]);

  const handleSave = async (id, updates) => {
    const syncedUpdates = { ...updates };
    if (updates.status === 'Inactive') {
      syncedUpdates.invite_status = 'inactive';
    } else if (updates.status === 'Active') {
      const member = members.find(m => m.id === id);
      if (member?.invite_status === 'inactive') {
        syncedUpdates.invite_status = member.user_id ? 'active' : 'invite_sent';
      }
    }
    await base44.entities.TeamMember.update(id, syncedUpdates);
    invalidateTeamMembersCache();
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...syncedUpdates } : m));
  };

  const handleRemove = async (memberId, mode) => {
    const res = await base44.functions.invoke('removeTeamMember', { member_id: memberId, mode });
    invalidateTeamMembersCache();
    if (mode === 'delete') {
      setMembers(prev => prev.filter(m => m.id !== memberId));
      setSelectedId(null);
      setDirty(false);
    } else {
      const updated = res.data?.member;
      if (updated) {
        setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...updated } : m));
      }
    }
  };

  const selected = members.find(m => m.id === selectedId);

  if (loading) {
    return (
      <div className="min-h-[50vh] bg-white p-6">
        <LoadingState cards={3} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-[50vh] bg-white p-6 flex items-center justify-center">
        <ErrorState
          title="Couldn't load team members"
          description="Please try again."
          onRetry={loadMembers}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] lg:h-screen bg-white">
      {/* List column — full width when no selection, fixed width when profile open */}
      <div
        className={cn(
          'h-full',
          selectedId
            ? 'hidden lg:flex lg:w-[400px] lg:border-r lg:border-zinc-200 lg:shrink-0'
            : 'flex w-full'
        )}
        onClick={(e) => {
          if (selectedId && !e.target.closest('button, input, [role="button"]')) {
            handleCloseRequest();
          }
        }}
      >
        <TeamMemberList
          members={members}
          selectedId={selectedId}
          onSelect={setSelectedId}
          search={search}
          setSearch={setSearch}
          onAdd={handleAdd}
        >
          <CalendarSyncCard />
        </TeamMemberList>
      </div>

      {/* Profile column — only rendered when a member is selected */}
      {selected && (
        <div className="h-full flex-1 flex">
          <TeamMemberProfile
            member={selected}
            onSave={handleSave}
            onBack={() => setSelectedId(null)}
            onSendInvite={handleSendInvite}
            onClose={handleCloseRequest}
            onDirtyChange={setDirty}
            onRemove={handleRemove}
          />
        </div>
      )}

      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCloseConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-zinc-900 mb-1">Discard changes?</h3>
            <p className="text-sm text-zinc-500 mb-4">You have unsaved changes that will be lost.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="flex-1 h-10 border border-zinc-200 text-zinc-700 text-sm font-semibold rounded-lg hover:bg-zinc-50 transition-colors"
              >
                Keep editing
              </button>
              <button
                onClick={() => { setShowCloseConfirm(false); setDirty(false); setSelectedId(null); }}
                className="flex-1 h-10 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <InviteStaffModal
          onClose={() => setShowInviteModal(false)}
          onInvited={handleInvited}
        />
      )}
    </div>
  );
}