/**
 * Twilio helpers shared by the sender (processMessageOutbox) and the delivery
 * status webhook (twilioStatusWebhook). New file — no scheduling core touched.
 */

/** The app's public address, from the APP_BASE_URL setting. Missing is an error, never a guess. */
export function appBaseUrl(): string {
  const v = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(v)) throw new Error('APP_BASE_URL is not set to an https address');
  return v;
}

/** The URL Twilio is told to call for delivery status, and the URL its signature is computed over. */
export const statusCallbackUrl = () => `${appBaseUrl()}/functions/twilioStatusWebhook`;

/** The URL Twilio is told to call when a customer replies, and what its signature covers. */
export const inboundUrl = () => `${appBaseUrl()}/functions/twilioInboundWebhook`;

export function toBase64(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

/** Twilio signature: base64(HMAC-SHA1(authToken, url + sorted(key+value...))). */
export async function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only if the header matches the signature for one of the candidate URLs. */
export async function verifyTwilioSignature(authToken: string, header: string | null, urls: string[], params: Record<string, string>): Promise<boolean> {
  if (!header || !authToken) return false;
  for (const url of urls) {
    if (safeEqual(await computeTwilioSignature(authToken, url, params), header)) return true;
  }
  return false;
}