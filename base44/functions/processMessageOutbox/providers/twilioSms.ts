import { normaliseAuPhone } from '../../../shared/auPhone.ts';
import { statusCallbackUrl } from '../../../shared/twilio.ts';
import type { MessageProvider, SendResult } from '../sender.ts';

/**
 * Twilio SMS adapter. Credentials are passed in from Base44 Secrets by the
 * dispatcher; they are never stored in code or entities.
 *
 * Failure classes:
 *   retryable — network error, timeout, HTTP 5xx, HTTP 429 / Twilio 20429.
 *   permanent — any other Twilio rejection (invalid number, unsubscribed
 *               recipient, blocked, etc.). Never retried.
 */
export interface TwilioConfig { accountSid: string; authToken: string; fromNumber: string }

const PERMANENT_HINTS: Record<number, string> = {
  21211: 'Invalid destination phone number.',
  21214: 'Destination number cannot receive SMS.',
  21215: 'Destination region is not enabled for SMS.',
  21408: 'Sending to this region is not permitted.',
  21610: 'Recipient has unsubscribed from messages (STOP).',
  21612: 'Twilio cannot route to this number.',
  21614: 'Destination is not a valid mobile number.',
  21617: 'Message is too long.',
};

const fail = (retryable: boolean, error: string, text = ''): SendResult =>
  ({ ok: false, retryable, error, providerMessageId: null, text });

export function createTwilioSms(cfg: TwilioConfig): MessageProvider {
  return {
    channel: 'sms',
    async send(item: any): Promise<SendResult> {
      const text = typeof item?.rendered_text === 'string' ? item.rendered_text.trim() : '';
      if (!text) return fail(false, 'Message has no rendered text, so there is nothing to send.');

      const national = normaliseAuPhone(item?.to_address);
      if (!national) return fail(false, 'Invalid number: not a supported Australian phone number.', text);
      const to = `+61${national.slice(1)}`; // 0412345678 -> +61412345678

      const body = new URLSearchParams({ To: to, From: cfg.fromNumber, Body: text, StatusCallback: statusCallbackUrl() });
      let res: Response;
      try {
        res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${btoa(`${cfg.accountSid}:${cfg.authToken}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        return fail(true, `Network error or timeout contacting Twilio: ${(e as Error)?.name || 'error'}`, text);
      }

      let json: any = null;
      try { json = await res.json(); } catch { json = null; }

      if (res.ok && json?.sid) {
        return { ok: true, retryable: false, error: null, providerMessageId: String(json.sid), text };
      }

      const code = Number(json?.code) || 0;
      const detail = `Twilio ${res.status}${code ? ` (code ${code})` : ''}: ${PERMANENT_HINTS[code] || json?.message || 'request rejected'}`;
      const retryable = res.status >= 500 || res.status === 429 || code === 20429;
      return fail(retryable, detail.slice(0, 300), text);
    },
  };
}