import { base44 } from '@/api/base44Client';

export const asList = (r) => (Array.isArray(r) ? r : (r?.items || []));

// One place for how an assistant outcome reads to Alvaro.
export const OUTCOME_META = {
  escalated: { label: 'Needs you', tone: 'warning' },
  drafted: { label: 'Draft ready', tone: 'warning' },
  stopped: { label: 'Guard stopped it', tone: 'danger' },
  acknowledged: { label: 'Change request', tone: 'warning' },
  queued: { label: 'Answered', tone: 'success' },
  skipped: { label: 'Ignored', tone: 'neutral' },
  processing: { label: 'Working', tone: 'neutral' },
};

export const CLASS_LABEL = { answerable: 'Routine question', change_request: 'Change request', escalate: 'Escalated', none: 'Not classified' };

export const MODES = {
  off: { label: 'Off', text: 'Classifies messages and flags the ones that need you. Writes no replies.' },
  draft: { label: 'Draft', text: 'Writes a reply for routine questions and waits. Nothing is sent until you tap Send on the Messages page.' },
  live: { label: 'Live', text: 'Sends replies to routine questions automatically (still through the message queue, so messaging mode, opt-outs and quiet hours apply).' },
};

async function call(name, payload) {
  try {
    const res = await base44.functions.invoke(name, payload);
    return { ok: true, ...(res?.data || {}) };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.error || e?.response?.data?.message || e?.message || 'That did not work. Please try again.' };
  }
}

export const sendAssistantDraft = (eventId) => call('assistantSendDraft', { event_id: eventId });
export const setAssistantMode = (mode) => call('setAssistantMode', { mode });

export async function markHandled(eventId) {
  const me = await base44.auth.me().catch(() => null);
  return base44.entities.AssistantEvent.update(eventId, {
    inbox_status: 'resolved', resolved_by: me?.full_name || me?.email || 'Admin', resolved_at: new Date().toISOString(),
  });
}

/** Open items count for the sidebar. */
export const countOpenAssistantItems = () => base44.entities.AssistantEvent.count({ inbox_status: 'open' });