import { normaliseAuPhone } from './auPhone.ts';

/**
 * The messaging safety gate. Applies to every outbox item (automated and manual),
 * because the sweep is the only code that ever reaches the SMS provider.
 *
 *   off        nothing is sent to anyone
 *   allowlist  only numbers on MessagingSettings.allowlist_numbers
 *   live       everyone
 *
 * Fail-safe: a missing record, a missing field or an unknown value means
 * allowlist, so an unconfigured app can never message a real customer.
 */
export type MessagingMode = 'off' | 'allowlist' | 'live';

export const MODE_OFF_REASON = 'messaging is switched off';
export const MODE_ALLOWLIST_REASON = 'not on the messaging allowlist';

export interface ModeConfig { mode: MessagingMode; allowlist: Set<string> }

export const parseMode = (v: unknown): MessagingMode =>
  v === 'off' || v === 'live' || v === 'allowlist' ? v : 'allowlist';

/** Normalised set of the allowlisted numbers; entries that are not AU numbers are ignored. */
export function allowlistSet(list: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    const n = normaliseAuPhone(raw);
    if (n) out.add(n);
  }
  return out;
}

export async function loadMessagingMode(admin: any): Promise<ModeConfig> {
  const res = await admin.entities.MessagingSettings.list('-created_date', 1);
  const row = (Array.isArray(res) ? res : res?.items || [])[0];
  return { mode: parseMode(row?.messaging_mode), allowlist: allowlistSet(row?.allowlist_numbers) };
}

/** The suppression reason for this item under the current mode, or null when it may go on. */
export function modeBlock(cfg: ModeConfig, item: { channel?: string; to_address?: string }): string | null {
  if (cfg.mode === 'live') return null;
  if (cfg.mode === 'off') return MODE_OFF_REASON;
  const channel = String(item.channel || '');
  if (channel !== 'sms' && channel !== 'whatsapp') return MODE_ALLOWLIST_REASON;
  const number = normaliseAuPhone(String(item.to_address || '').replace(/^whatsapp:/i, ''));
  return number && cfg.allowlist.has(number) ? null : MODE_ALLOWLIST_REASON;
}