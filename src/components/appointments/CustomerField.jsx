import React, { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

const input = 'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

/**
 * Customer — search an existing client, or type a new one in.
 *
 * A new client is NOT saved here: the sheet creates the record when the appointment
 * is saved, so abandoning the form never leaves a stray client behind.
 */
export default function CustomerField({ client, onChange, clients }) {
  const [query, setQuery] = useState('');
  const [listing, setListing] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 6);
    return clients.filter(c =>
      c.client_name?.toLowerCase().includes(q)
      || (c.phone || '').includes(query.trim())
      || c.email?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [clients, query]);

  const choose = (record) => {
    const address = [record.address, record.suburb, record.postcode].filter(Boolean).join(', ');
    onChange({ id: record.id, name: record.client_name || '', phone: record.phone || '', email: record.email || '',
      address: address || record.address || '', record, isNew: false });
    setListing(false);
    setQuery('');
  };

  const clear = () => onChange({ id: null, name: '', phone: '', email: '', address: '', record: null, isNew: false });

  if (client.id) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-700">
          {client.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">{client.name}</p>
          <p className="truncate text-xs text-zinc-500">{client.phone}{client.address ? ` · ${client.address}` : ''}</p>
        </div>
        <button type="button" onClick={clear} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800">
          Change
        </button>
      </div>
    );
  }

  if (client.isNew || client.name) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-500">New client</p>
          <button type="button" onClick={clear} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">Cancel</button>
        </div>
        <input className={input} placeholder="Full name" value={client.name} onChange={e => onChange({ name: e.target.value })} autoFocus />
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={input} placeholder="Phone" value={client.phone} onChange={e => onChange({ phone: e.target.value })} />
          <input className={input} placeholder="Email (optional)" value={client.email} onChange={e => onChange({ email: e.target.value })} />
        </div>
        <input className={input} placeholder="Service address" value={client.address} onChange={e => onChange({ address: e.target.value })} />
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        className={cn(input, 'pl-9')}
        placeholder="Search a client by name, phone or email"
        value={query}
        onChange={e => { setQuery(e.target.value); setListing(true); }}
        onFocus={() => setListing(true)}
      />
      {listing && (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {matches.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => choose(c)}
              className="flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-left last:border-0 hover:bg-violet-50/60"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
                {(c.client_name || '?').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">{c.client_name}</p>
                <p className="truncate text-xs text-zinc-500">{c.phone}{c.suburb ? ` · ${c.suburb}` : ''}</p>
              </div>
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-3 py-3 text-xs text-zinc-500">No client matches that yet.</p>
          )}
          <button
            type="button"
            onClick={() => { onChange({ isNew: true, name: query.trim() }); setListing(false); setQuery(''); }}
            className="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2.5 text-left text-xs font-semibold text-violet-700 hover:bg-violet-50"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {query.trim() ? `Create "${query.trim()}"` : 'Create a new client'}
          </button>
        </div>
      )}
    </div>
  );
}