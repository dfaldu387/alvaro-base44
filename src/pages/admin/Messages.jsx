import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import useConversationList from '@/hooks/useConversationList';
import useDeliveryProblems from '@/hooks/useDeliveryProblems';
import OutboxHealthStrip from '@/components/messages/OutboxHealthStrip';
import ConversationList from '@/components/messages/ConversationList';
import ConversationThread from '@/components/messages/ConversationThread';
import DeliveryProblems from '@/components/messages/DeliveryProblems';
import OptedOutFollowUp from '@/components/messages/OptedOutFollowUp';
import EscalationInbox from '@/components/assistant/EscalationInbox';
import useOpenAssistantCount from '@/hooks/useOpenAssistantCount';
import ErrorState from '@/components/states/ErrorState';
import AdminPage from '@/components/admin/ui/AdminPage';

const Tab = ({ active, onClick, children }) => (
  <button onClick={onClick} className={cn('px-3 py-1.5 text-xs font-semibold rounded-md', active ? 'bg-indigo-600 text-white' : 'text-zinc-600 hover:bg-zinc-100')}>{children}</button>
);

export default function Messages() {
  const [tab, setTab] = useState('conversations');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  // /admin/messages?client=<id> opens that client's thread (used by the Reminders board).
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('client'));
  const [tick, setTick] = useState(0);
  const openAssistant = useOpenAssistantCount();
  // The subtitle used to say "Test mode — not delivered" no matter what. Once the gate is live
  // that is a lie on the one page where it matters most, so it reads the real mode. Unknown is
  // reported as unknown rather than guessed, because the safe-sounding guess is the dangerous one.
  const [mode, setMode] = useState(null);

  // New replies, status updates and queue changes refresh the page on their own.
  useEffect(() => {
    let t;
    const bump = () => { clearTimeout(t); t = setTimeout(() => setTick((x) => x + 1), 600); };
    const offMessages = base44.entities.Message.subscribe(bump);
    const offOutbox = base44.entities.MessageOutbox.subscribe(bump);
    return () => { offMessages(); offOutbox(); clearTimeout(t); };
  }, []);

  useEffect(() => {
    let live = true;
    base44.entities.MessagingSettings.list('-created_date', 1)
      .then((rows) => {
        if (!live) return;
        const row = (Array.isArray(rows) ? rows : rows?.items || [])[0];
        const v = row?.messaging_mode;
        // Matches the server's fail-safe in shared/messagingMode.ts: anything unrecognised is allowlist.
        setMode(v === 'off' || v === 'live' ? v : 'allowlist');
      })
      .catch(() => live && setMode('unknown'));
    return () => { live = false; };
  }, [tick]);

  const MODE_TEXT = {
    live: 'Messaging is LIVE — real customers receive these messages.',
    allowlist: 'Allowlist only — everyone not on the list is suppressed.',
    off: 'Messaging is off — nothing is sent to anyone.',
    unknown: 'Messaging mode could not be read — check Automation before relying on this page.',
  };
  const subtitle = `Every conversation with your clients, and the queue behind it.${mode ? ` ${MODE_TEXT[mode]}` : ''}`;

  const list = useConversationList(tick, search);
  const problems = useDeliveryProblems(tick);
  const refresh = () => setTick((x) => x + 1);
  const select = (id) => { if (id) setSelectedId(id); };

  return (
    <AdminPage title="Messages" subtitle={subtitle}>

      <OutboxHealthStrip tick={tick} />

      <div className="flex gap-1 mb-3">
        <Tab active={tab === 'conversations'} onClick={() => setTab('conversations')}>Conversations</Tab>
        <Tab active={tab === 'needsyou'} onClick={() => setTab('needsyou')}>Needs you{openAssistant > 0 ? ` (${openAssistant})` : ''}</Tab>
        <Tab active={tab === 'optedout'} onClick={() => setTab('optedout')}>Opted-out follow-up</Tab>
      </div>

      {tab === 'needsyou' ? <EscalationInbox onOpenConversation={(id) => { setSelectedId(id); setTab('conversations'); }} />
        : tab === 'optedout' ? <OptedOutFollowUp /> : (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden flex h-[640px]">
          <div className={cn('w-full md:w-[320px] md:border-r border-zinc-200 flex-col shrink-0 min-h-0', selectedId ? 'hidden md:flex' : 'flex')}>
            <div className="p-3 border-b border-zinc-200 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a client…" className="pl-8 bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400" />
              </div>
              <div className="flex gap-1">
                <Tab active={filter === 'all'} onClick={() => setFilter('all')}>All</Tab>
                <Tab active={filter === 'failed'} onClick={() => setFilter('failed')}>Failed</Tab>
                <Tab active={filter === 'dead'} onClick={() => setFilter('dead')}>Dead-lettered</Tab>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filter !== 'all' ? (
                <DeliveryProblems state={problems} kind={filter} onSelect={select} />
              ) : list.loading ? (
                <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : list.error ? (
                <ErrorState title="Couldn't load conversations" description="Please try again." onRetry={refresh} />
              ) : (
                <ConversationList
                  conversations={list.conversations}
                  selectedId={selectedId}
                  onSelect={select}
                  hasMore={list.hasMore}
                  onLoadMore={list.loadMore}
                  searching={list.searching}
                />
              )}
            </div>
          </div>

          <div className={cn('flex-1 min-w-0', selectedId ? 'flex' : 'hidden md:flex')}>
            {selectedId ? (
              <ConversationThread clientId={selectedId} tick={tick} onBack={() => setSelectedId(null)} onQueued={refresh} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">Select a conversation</div>
            )}
          </div>
        </div>
      )}
    </AdminPage>
  );
}