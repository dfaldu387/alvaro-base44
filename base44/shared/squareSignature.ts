import { appBaseUrl, safeEqual, toBase64 } from './twilio.ts';

/** Square signs: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)), sent in this header. */
export const SQUARE_SIGNATURE_HEADER = 'x-square-hmacsha256-signature';

export async function computeSquareSignature(signatureKey: string, notificationUrl: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signatureKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(notificationUrl + rawBody)));
}

/** True only if the header matches the signature of the RAW body for one of the candidate URLs. */
export async function verifySquareSignature(signatureKey: string, header: string | null, urls: string[], rawBody: string): Promise<boolean> {
  if (!header || !signatureKey) return false;
  for (const url of urls) {
    if (safeEqual(await computeSquareSignature(signatureKey, url, rawBody), header)) return true;
  }
  return false;
}

/** The address Alvaro registers in the Square dashboard (the app's public address + the function path). */
export function squareWebhookUrl(): string | null {
  try { return `${appBaseUrl()}/functions/squareWebhook`; } catch { return null; }
}

/** The URLs a signature may be computed over: the configured address, then the one this request arrived on. */
export function squareNotificationUrls(requestUrl: string): string[] {
  const configured = squareWebhookUrl();
  return configured ? [configured, requestUrl] : [requestUrl];
}