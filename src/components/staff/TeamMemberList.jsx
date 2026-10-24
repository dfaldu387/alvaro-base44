/**
 * TeamMemberList — middle column: search, add button, and team member table.
 * On narrow screens each row becomes a stacked card.
 */
import React from 'react';
import { Search, Plus, ChevronRight, Clock, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/admin/ui/StatusBadge';

const ROW_GRID = 'grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_80px_70px_70px_24px]';

export default function TeamMemberList({ members, selectedId, onSelect, search, setSearch, onAdd, onBack, children }) {
  const filtered = search.trim()
    ? members.filter(m => m.name?.toLowerCase().includes(search.toLowerCase()) || m.job_title?.toLowerCase().includes(search.toLowerCase()))
    : members;

  return (
    <div className="flex flex-col h-full w-full bg-white min-w-0">
      {/* Header */}
      <div className="px-4 sm:px-5 pt-5 pb-4 border-b border-zinc-200">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 mb-3 lg:hidden">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">Team members</h1>
        <p className="text-sm text-zinc-500 mt-1">Staff profiles, working hours and access</p>
        <div className="flex items-center gap-2 mt-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search team members"
              className="h-10 bg-zinc-50 pl-9"
            />
          </div>
          <Button onClick={onAdd} className="min-h-[44px] shrink-0 gap-1.5">
            <Plus className="w-4 h-4" /> Add
          </Button>
        </div>
      </div>

      {/* Slot for a page-level panel (e.g. connect your own Google Calendar) */}
      {children && <div className="px-4 sm:px-5 py-3 border-b border-zinc-200">{children}</div>}

      {/* Table header (hidden on phones — rows become cards) */}
      <div className="hidden sm:block px-5 py-2.5 border-b border-zinc-200 bg-zinc-50/50">
        <div className="grid grid-cols-[1fr_80px_70px_70px_24px] gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
          <span>Name</span>
          <span>Job</span>
          <span>Bookable</span>
          <span>Status</span>
          <span />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-8">No team members found.</p>
        ) : (
          <div className="space-y-1.5">
            {filtered.map(m => {
              const isSelected = m.id === selectedId;
              const invite = m.invite_status === 'invite_sent' ? 'Invite sent' : m.invite_status === 'inactive' ? 'Inactive' : '';
              return (
                <button
                  key={m.id}
                  onClick={() => onSelect(m.id)}
                  className={cn(
                    ROW_GRID, 'w-full gap-2 items-center px-3 py-3 min-h-[56px] rounded-xl border transition-all text-left',
                    isSelected ? 'border-indigo-600 bg-indigo-50' : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
                  )}
                >
                  {/* Name + avatar */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ background: m.avatar_color || '#5E42F3' }}
                    >
                      {m.initials || m.name?.slice(0, 2).toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 truncate">{m.name}</p>
                      <div className="flex items-center gap-1.5">
                        {m.role === 'owner' && <span className="text-[11px] text-zinc-400">You</span>}
                        {invite && (
                          <StatusBadge tone={m.invite_status === 'invite_sent' ? 'warning' : 'neutral'}>{invite}</StatusBadge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Mobile: arrow sits beside the name */}
                  <ChevronRight className="w-4 h-4 text-zinc-300 sm:hidden" />

                  {/* Job · Bookable · Status — a row under the name on phones, grid columns from sm up */}
                  <div className="col-span-2 sm:contents flex flex-wrap items-center gap-x-4 gap-y-1 pl-[46px] sm:pl-0">
                    <span className="text-xs text-zinc-600 truncate">{m.job_title || '—'}</span>
                    <div className="flex items-center gap-1">
                      <span className={cn('w-1.5 h-1.5 rounded-full', m.is_bookable ? 'bg-emerald-500' : 'bg-zinc-300')} />
                      <span className="text-xs text-zinc-600">{m.is_bookable ? 'Bookable' : 'Not bookable'}</span>
                    </div>
                    <div>
                      <StatusBadge tone={(m.status || 'Active') === 'Active' ? 'success' : 'neutral'}>{m.status || 'Active'}</StatusBadge>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-300 hidden sm:block" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* About working hours footer */}
      <div className="p-4 border-t border-zinc-200">
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
          <div className="flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-zinc-900">About working hours</p>
              <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                Working hours control when each team member is available for bookings. They feed your calendar, booking requests, and online booking availability.
              </p>
              <button className="text-xs font-semibold text-indigo-600 mt-1.5 hover:underline">Learn more</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}