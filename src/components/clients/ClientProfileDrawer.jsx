import React, { useMemo, useState } from 'react';
import {
  X, MoreHorizontal, Pencil, Phone, Mail, MapPin, Plus, ChevronRight, ShoppingBasket,
  CalendarPlus, MessageCircle, Pause, Play, Repeat, Users, Trash2, Clock, Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/reminderUtils';
import ClientMessagingSummary from '@/components/clients/ClientMessagingSummary';
import ClientHistoryStats from '@/components/review/ClientHistoryStats';
import {
  STATUS_STYLES, completedForClient, clientStatus, clientStats, systemTags,
  availabilityTypeDisplay, lastVisitDate, firstVisitDate, normalisePhone, formatPhoneAu,
  frequentServices, formatVisitDate, findDuplicate,
} from '@/lib/clientStatus';

const BOOKING_STATUS_LABEL = {
  pending: 'Pending', confirmed: 'Confirmed', waitlist: 'Waitlist',
  completed: 'Completed', declined: 'Cancelled', blocked: 'Blocked',
};
const BOOKING_STATUS_STYLE = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-emerald-50 text-emerald-700',
  waitlist: 'bg-zinc-100 text-zinc-600',
  completed: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-red-50 text-red-600',
  blocked: 'bg-zinc-100 text-zinc-500',
};

export default function ClientProfileDrawer({ client, bookings, allClients, onClose, onEdit, onAction, busy }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookingTab, setBookingTab] = useState('upcoming');
  const [addingNote, setAddingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [tagText, setTagText] = useState('');
  const [showAllTx, setShowAllTx] = useState(false);

  const completed = useMemo(() => completedForClient(bookings, client), [bookings, client]);
  const mine = useMemo(
    () => bookings.filter(b => (b.client_name || '').toLowerCase() === (client.client_name || '').toLowerCase()),
    [bookings, client]
  );
  const status = clientStatus(client, completed);
  const stats = clientStats(client, completed);
  const sysTags = systemTags(client, stats);
  const manualTags = client.manual_tags || [];
  const last = lastVisitDate(completed);
  const first = firstVisitDate(completed);
  const frequent = useMemo(() => frequentServices(completed), [completed]);
  const duplicate = useMemo(() => findDuplicate(client, allClients), [client, allClients]);

  const transactions = useMemo(
    () => completed.filter(b => b.price != null).sort((a, b) => (b.updated_date || '').localeCompare(a.updated_date || '')),
    [completed]
  );
  const txToShow = showAllTx ? transactions : transactions.slice(0, 3);

  const upcoming = mine.filter(b => ['pending', 'confirmed', 'waitlist'].includes(b.status));
  const previous = mine.filter(b => ['completed', 'declined', 'blocked'].includes(b.status));

  const saveNote = () => { onAction('addNote', client, noteText); setNoteText(''); setAddingNote(false); };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/30 sm:bg-transparent sm:pointer-events-none" onClick={onClose} />
      <div className="relative w-full sm:max-w-[440px] bg-white border-l border-zinc-200 h-full overflow-y-auto flex flex-col shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center justify-between">
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400"><X className="w-4 h-4" /></button>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <button onClick={() => setMenuOpen(v => !v)} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-500"><MoreHorizontal className="w-4 h-4" /></button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 mt-1 z-40 w-56 bg-white border border-zinc-200 rounded-lg shadow-xl py-1">
                      <MenuItem icon={CalendarPlus} label="Book appointment" onClick={() => { setMenuOpen(false); onAction('book', client); }} />
                      <MenuItem icon={MessageCircle} label="Message client" onClick={() => { setMenuOpen(false); onAction('message', client); }} />
                      {!client.is_paused && <MenuItem icon={Pause} label="Pause client" onClick={() => { setMenuOpen(false); onAction('pause', client); }} />}
                      {client.is_paused && <MenuItem icon={Play} label="Resume client" onClick={() => { setMenuOpen(false); onAction('resume', client); }} />}
                      {!client.recurring_enabled && <MenuItem icon={Repeat} label="Add to recurring reminders" onClick={() => { setMenuOpen(false); onAction('addRecurring', client); }} />}
                      {client.recurring_enabled && <MenuItem icon={Repeat} label="Remove from recurring reminders" onClick={() => { setMenuOpen(false); onAction('removeRecurring', client); }} />}
                      {duplicate && <MenuItem icon={Users} label="Merge duplicate client" onClick={() => { setMenuOpen(false); onAction('merge', client, duplicate); }} />}
                      <div className="border-t border-zinc-100 my-1" />
                      <MenuItem icon={Trash2} label="Delete client" danger onClick={() => { setMenuOpen(false); onAction('delete', client); }} />
                    </div>
                  </>
                )}
              </div>
              {/* Favourite — same is_favourite field as the table star */}
              <button
                onClick={() => onAction('favourite', client)}
                disabled={busy}
                className={cn(
                  'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors',
                  client.is_favourite === true
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'border-amber-200 bg-white text-amber-600 hover:bg-amber-50'
                )}
              >
                <Star className={cn('w-3.5 h-3.5', client.is_favourite === true ? 'fill-amber-400 text-amber-400' : 'text-amber-400')} />
                {client.is_favourite === true ? 'Favourited' : 'Add to Favourites'}
              </button>
              <Button size="sm" variant="outline" className="bg-white border-zinc-200 text-zinc-700 h-8" onClick={onEdit} disabled={busy}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold">{initials(client.client_name)}</div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900">{client.client_name}</h2>
              <span className={cn('inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium mt-0.5', STATUS_STYLES[status])}>{status}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Metric label="Visits" value={completed.length} />
            <Metric label="Last visit" value={last ? formatVisitDate(last) : '—'} />
            <Metric label="First visit" value={first ? formatVisitDate(first) : '—'} />
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-6 flex-1">
          <Section>
            <Row label="Phone" value={client.phone ? formatPhoneAu(client.phone) : '—'} href={client.phone ? `tel:${normalisePhone(client.phone)}` : null} />
            <Row label="Email" value={client.email || '—'} href={client.email ? `mailto:${client.email}` : null} />
            <Row label="Address" value={[client.address, client.suburb, client.postcode].filter(Boolean).join(', ') || '—'} />
          </Section>

          <Section title="Client details">
            <Row label="Status" value={status} />
            <Row label="Frequency" value={client.frequency || 'None'} />
            <Row label="Availability type" value={availabilityTypeDisplay(client)} />
            <Row label="Usual service" value={client.usual_service || '—'} />
          </Section>

          <Section title="Booking history">
            <ClientHistoryStats clientId={client.id} />
          </Section>

          <Section title="Messaging">
            <ClientMessagingSummary client={client} />
          </Section>

          <Section title="Tags" action={<div className="flex items-center gap-1.5"><input value={tagText} onChange={e => setTagText(e.target.value)} placeholder="Add tag…" className="h-7 w-28 text-xs rounded-md border border-zinc-200 px-2" /><button onClick={() => { if (tagText.trim()) { onAction('addTag', client, tagText.trim()); setTagText(''); } }} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Add</button></div>}>
            <div className="flex flex-wrap gap-1.5">
              {sysTags.map(t => <span key={'sys' + t} className="inline-flex px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-500 text-[11px] font-medium">{t}</span>)}
              {manualTags.map(t => <span key={'man' + t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-medium">{t}<button onClick={() => onAction('removeTag', client, t)} className="hover:text-indigo-900"><X className="w-2.5 h-2.5" /></button></span>)}
              {sysTags.length === 0 && manualTags.length === 0 && <span className="text-sm text-zinc-400">No tags yet.</span>}
            </div>
            <p className="text-[10px] text-zinc-400 mt-1.5">Grey labels are system-generated from your data. Coloured tags are manual.</p>
          </Section>

          <Section title="Notes and files" action={<button onClick={() => setAddingNote(v => !v)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Add</button>}>
            {client.notes && !addingNote && <p className="text-sm text-zinc-700 whitespace-pre-wrap">{client.notes}</p>}
            {!client.notes && !addingNote && <p className="text-sm text-zinc-400">No notes yet.</p>}
            {addingNote && (
              <div className="space-y-2">
                <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} placeholder="Add a note…" className="bg-white border-zinc-200 text-zinc-900" />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" className="bg-white border-zinc-200 text-zinc-600" onClick={() => { setAddingNote(false); setNoteText(''); }}>Cancel</Button>
                  <Button size="sm" className="bg-[#6366F1] hover:bg-[#5457e6] text-white" onClick={saveNote} disabled={!noteText.trim()}>Save note</Button>
                </div>
              </div>
            )}
          </Section>

          <Section title="Transactions" action={transactions.length > 3 ? <button onClick={() => setShowAllTx(v => !v)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">{showAllTx ? 'Show less' : 'View all'}</button> : null}>
            {transactions.length === 0 ? <p className="text-sm text-zinc-400">No transactions yet.</p> : (
              <div>
                {txToShow.map(t => (
                  <div key={t.id} className="flex items-center gap-3 py-2 border-b border-zinc-50 last:border-0">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><ShoppingBasket className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900">${(t.price || 0).toFixed(2)}</p>
                      <p className="text-[11px] text-zinc-400 truncate">{(t.services || []).join(', ') || 'Purchase'} · {formatVisitDate(t.updated_date || t.created_date)}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-300" />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Bookings" action={<button onClick={() => onAction('book', client)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Book appointment</button>}>
            <div className="flex gap-2 mb-3">
              {['upcoming', 'previous'].map(t => (
                <button key={t} onClick={() => setBookingTab(t)} className={cn('px-3 py-1 rounded-full text-xs font-medium border', bookingTab === t ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50')}>{t[0].toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
            {bookingTab === 'upcoming' && (upcoming.length === 0 ? <p className="text-sm text-zinc-400">No upcoming bookings.</p> : <BookingList items={upcoming} />)}
            {bookingTab === 'previous' && (previous.length === 0 ? <p className="text-sm text-zinc-400">No previous bookings.</p> : <BookingList items={previous} />)}
          </Section>

          <Section title="Frequent services">
            {frequent.length === 0 ? <p className="text-sm text-zinc-400">No frequent services yet.</p> : (
              <div className="space-y-2">
                {frequent.map(s => (
                  <div key={s.name} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-400 shrink-0"><Clock className="w-4 h-4" /></div>
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{s.name}</p>
                      <p className="text-[11px] text-zinc-400">Purchased {s.count} {s.count === 1 ? 'time' : 'times'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Recurring booking">
            {client.recurring_enabled ? (
              <div>
                <p className="text-sm text-zinc-800">{[client.recurring_frequency, availabilityTypeDisplay(client)].filter(Boolean).join(' · ') || 'Enabled'}</p>
                <p className="text-[13px] text-zinc-600 mt-0.5">
                  {client.recurring_day || 'Any day'}
                  {client.scheduling_category === 'Fixed Window' && (client.recurring_window_start || client.recurring_window_end) ? ` between ${client.recurring_window_start || '—'} and ${client.recurring_window_end || '—'}` : (client.recurring_time ? ` at ${client.recurring_time}` : '')}
                </p>
                {client.recurring_service && <p className="text-[11px] text-zinc-400 mt-0.5">Default service: {client.recurring_service}</p>}
                {client.next_cycle_date && <p className="text-[11px] text-zinc-400 mt-0.5">Next cycle: {formatVisitDate(client.next_cycle_date)}</p>}
                <p className="text-[11px] text-zinc-400 mt-0.5">{client.show_on_weekly_schedule !== false ? 'Shown on weekly schedule' : 'Hidden from weekly schedule'}</p>
                {client.recurring_paused && <p className="text-[11px] text-amber-600 mt-0.5">Paused</p>}
                {client.recurring_skip_cycle && <p className="text-[11px] text-amber-600 mt-0.5">Skipping next cycle</p>}
                <Button size="sm" variant="outline" className="bg-white border-zinc-200 text-zinc-700 h-8 mt-2" onClick={onEdit} disabled={busy}><Pencil className="w-3.5 h-3.5" /> Edit Recurring Booking</Button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-zinc-400">Not enabled</p>
                <Button size="sm" variant="outline" className="bg-white border-zinc-200 text-zinc-700 h-8 mt-2" onClick={onEdit} disabled={busy}><Repeat className="w-3.5 h-3.5" /> Enable Recurring Booking</Button>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg bg-zinc-50 py-2">
      <p className="text-base font-semibold text-zinc-900">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <div>
      {title && (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Row({ label, value, href }) {
  const content = href
    ? <a href={href} className="text-sm text-indigo-600 hover:underline">{value}</a>
    : <span className="text-sm text-zinc-800">{value}</span>;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-zinc-50 last:border-0">
      <span className="text-xs text-zinc-400">{label}</span>
      {content}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button onClick={onClick} className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50', danger ? 'text-red-600' : 'text-zinc-700')}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function BookingList({ items }) {
  return (
    <div className="space-y-2">
      {items.map(b => (
        <div key={b.id} className="flex items-center justify-between rounded-lg border border-zinc-100 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 truncate">{(b.services || []).join(', ') || b.time_block || 'Booking'}</p>
            <p className="text-[11px] text-zinc-400">{b.day || '—'} {b.assigned_time || ''} · {formatVisitDate(b.updated_date || b.created_date)}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
            <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium', BOOKING_STATUS_STYLE[b.status] || 'bg-zinc-100 text-zinc-600')}>{BOOKING_STATUS_LABEL[b.status] || b.status}</span>
            {b.payment_status && <span className="text-[10px] text-zinc-400">{b.payment_status}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}