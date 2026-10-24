import { secrets } from 'base44:runtime';
import { createTwilioSms } from './providers/twilioSms.ts';

/**
 * The single sender interface the sweep depends on. To add WhatsApp or email,
 * write another adapter that implements MessageProvider and register it in
 * getProvider() — the sweep itself does not change.
 *
 * SAFE BY DEFAULT: unless the secret MESSAGING_LIVE is exactly "true", the
 * sender is a test double. It delivers nothing, needs no Twilio credentials,
 * and every Message it produces is flagged simulated.
 */
export interface SendResult {
  ok: boolean;
  /** Only meaningful when ok is false: true = back off and retry, false = dead-letter now. */
  retryable: boolean;
  error: string | null;
  providerMessageId: string | null;
  text: string;
}

export interface MessageProvider {
  channel: string;
  send(item: any): Promise<SendResult>;
}

const REQUIRED = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];

/** Real delivery is opt-in. Anything other than the exact value "true" stays simulated. */
export function isLive(): boolean {
  return String(secrets.get('MESSAGING_LIVE') || '').trim().toLowerCase() === 'true';
}

/** Names of required secrets that are not set. Always empty in simulated mode. */
export function missingSecrets(): string[] {
  if (!isLive()) return [];
  return REQUIRED.filter(name => !String(secrets.get(name) || '').trim());
}

/** Test double: reports success, delivers nothing, logs no address or content. */
function simulatedProvider(channel: string): MessageProvider {
  return {
    channel,
    async send(item: any): Promise<SendResult> {
      const text = typeof item?.rendered_text === 'string' ? item.rendered_text.trim() : '';
      if (!text) {
        return { ok: false, retryable: false, error: 'Message has no rendered text, so there is nothing to send.', providerMessageId: null, text: '' };
      }
      console.log(JSON.stringify({ event: 'simulated_send', outbox_id: item?.id, channel }));
      return { ok: true, retryable: false, error: null, providerMessageId: `SIMULATED-${item?.id}`, text };
    },
  };
}

/** The adapter for a channel, or null when the channel has no provider yet. */
export function getProvider(channel: string): MessageProvider | null {
  if (!isLive()) return simulatedProvider(channel);
  if (channel === 'sms') {
    return createTwilioSms({
      accountSid: String(secrets.get('TWILIO_ACCOUNT_SID')).trim(),
      authToken: String(secrets.get('TWILIO_AUTH_TOKEN')).trim(),
      fromNumber: String(secrets.get('TWILIO_FROM_NUMBER')).trim(),
    });
  }
  return null;
}