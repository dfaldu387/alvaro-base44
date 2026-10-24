import React from 'react';
import { X, Send, MessageCircle, CalendarPlus, Move, SkipForward, Pause, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatDateShort, followUpDueDate, initials } from '@/lib/reminderUtils';

const STAGE_LABEL = {
  needs_reminder: 'Needs Reminder',
  waiting_on_response: 'Waiting on Client',
  time_received: 'Ready to Schedule',
};
const STAGE_BADGE = {
  needs_reminder: 'bg-orange-100 text-orange-700',
  waiting_on_response: 'bg-blue-100 text-blue-700',
  time_received: 'bg-amber-100 text-amber-700',
};

export default function WeekClientDrawer({ client, onClose, busy,
  onSendReminder, onFollowUp, onMarkReplied, onAddToSchedule, onOpenChat, onMoveRequest, onSkipCycle, onPauseReminders, onNotInterested }) {
  if (!client) return null;
  const stage = client._stage || client.workflow_stage;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-[420px] bg-white border-l border-zinc-200 h-full overflow-y-auto flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold">{initials(client.client_name)}</div>
              <div>
                <h2 className="text-base font-bold text-zinc-900">{client.client_name}</h2>
                <p className="text-xs text-zinc-500">{client.usual_service || '—'}</p>
                <span className={cn('inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1', STAGE_BADGE[stage])}>{STAGE_LABEL[stage]}</span>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">
          <div className="space-y-2">
            <DetailRow label="Frequency" value={client.frequency || '—'} />
            <DetailRow label="Last Appointment" value={client.last_visit_date ? formatDateShort(client.last_visit_date) : '—'} />
            <DetailRow label="Due Date" value={client.next_reminder_date ? formatDateShort(client.next_reminder_date) : '—'} />
            <DetailRow label="Area" value={client.suburb || '—'} />
            <DetailRow label="Address" value={[client.address, client.suburb, client.postcode].filter(Boolean).join(', ') || '—'} />
            {client.availability_window && <DetailRow label="Availability" value={client.availability_window} />}
          </div>

          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Notes</p>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 min-h-[60px]">
              {client.notes || client.weekly_note || 'No notes yet.'}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Conversation</p>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-[10px] text-zinc-400 mb-1">{client.reminder_sent_date ? `Last contact: ${formatDateShort(client.reminder_sent_date)}` : 'No messages sent yet'}</p>
              <p className="text-sm text-zinc-700">{client.reminder_message || 'No conversation history.'}</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 sticky bottom-0 bg-white space-y-2">
          {stage === 'needs_reminder' && (
            <>
              <Button onClick={() => onSendReminder(client)} disabled={busy} className="w-full bg-orange-500 hover:bg-orange-600 text-white h-10"><Send className="w-4 h-4" /> Send Reminder</Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-zinc-200 text-zinc-700 h-9" onClick={() => onOpenChat(client)}><MessageCircle className="w-4 h-4" /> Open Chat</Button>
                <Button variant="outline" className="flex-1 border-zinc-200 text-zinc-700 h-9" onClick={() => onMoveRequest(client)}><Move className="w-4 h-4" /> Move Request</Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-zinc-200 text-zinc-700 h-9" onClick={() => onSkipCycle(client)} disabled={busy}><SkipForward className="w-4 h-4" /> Skip Cycle</Button>
                <Button variant="outline" className="flex-1 border-zinc-200 text-zinc-700 h-9" onClick={() => onPauseReminders(client)} disabled={busy}><Pause className="w-4 h-4" /> Pause</Button>
              </div>
            </>
          )}
          {stage === 'waiting_on_response' && (
            <>
              <Button onClick={() => onFollowUp(client)} disabled={busy} className="w-full bg-blue-500 hover:bg-blue-600 text-white h-10"><Send className="w-4 h-4" /> Follow Up</Button>
              <Button onClick={() => onMarkReplied(client)} disabled={busy} className="w-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50 h-9 bg-white"><CheckCircle className="w-4 h-4" /> Mark Reply Received</Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-zinc-200 text-zinc-700 h-9" onClick={() => onOpenChat(client)}><MessageCircle className="w-4 h-4" /> Open Chat</Button>
                <Button variant="outline" className="flex-1 border-zinc-200 text-zinc-700 h-9" onClick={() => onMoveRequest(client)}><Move className="w-4 h-4" /> Move Request</Button>
              </div>
              <Button variant="outline" className="w-full border-red-200 text-red-600 hover:bg-red-50 h-9" onClick={() => onNotInterested(client)} disabled={busy}><AlertCircle className="w-4 h-4" /> Close as No Response</Button>
            </>
          )}
          {stage === 'time_received' && (
            <>
              <Button onClick={() => onAddToSchedule(client)} disabled={busy} className="w-full bg-[#6366F1] hover:bg-[#5457e6] text-white h-10"><CalendarPlus className="w-4 h-4" /> Add to Schedule</Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-zinc-200 text-zinc-700 h-9" onClick={() => onMoveRequest(client)}><Move className="w-4 h-4" /> Move Request</Button>
                <Button variant="outline" className="flex-1 border-zinc-200 text-zinc-700 h-9" onClick={() => onOpenChat(client)}><MessageCircle className="w-4 h-4" /> Open Chat</Button>
              </div>
              <Button variant="outline" className="w-full border-red-200 text-red-600 hover:bg-red-50 h-9" onClick={() => onNotInterested(client)} disabled={busy}><AlertCircle className="w-4 h-4" /> Could Not Fit</Button>
            </>
          )}
          <p className="text-[10px] text-zinc-400 text-center pt-1">Added to workflow on {formatDateShort(client.created_date)}</p>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-xs font-medium text-zinc-800 text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}