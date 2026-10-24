/**
 * The ONE template renderer. Used by the sweep (processMessageOutbox) to build
 * rendered_text and by renderMessagePreview for the admin editor preview, so
 * what the business previews is exactly what a customer would receive.
 *
 * Rules:
 *  - {{name}} style placeholders (letters, digits, underscore; spaces inside the
 *    braces are tolerated).
 *  - A value must be a non-blank string or a finite number. Anything else
 *    (missing, null, blank, object, NaN) counts as MISSING.
 *  - If ANY placeholder is missing nothing is rendered: the caller gets the
 *    reason and must not send. No empty gaps, no literal "{{name}}" in a message.
 *  - Single pass: a value that itself contains "{{x}}" is never expanded, and if
 *    braces survive in the final text the render is refused.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Variables that may be missing or blank without refusing the render: they carry
 * a whole optional sentence (the live arrival window, the tracking link). When
 * one is blank the message goes out with its plain wording and the gap is closed.
 * Every other variable still refuses to render when missing.
 */
export const OPTIONAL_VARIABLES = ['eta_window', 'tracking_link'];

export type RenderResult =
  | { ok: true; text: string }
  | { ok: false; reason: string; missing: string[] };

function usable(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export function renderTemplate(body: unknown, payload: unknown): RenderResult {
  if (typeof body !== 'string' || body.trim() === '') {
    return { ok: false, reason: 'template body is empty', missing: [] };
  }
  const data: Record<string, unknown> =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};

  const missing: string[] = [];
  let blanked = false;
  let text = body.replace(PLACEHOLDER, (_m, name: string) => {
    const value = Object.prototype.hasOwnProperty.call(data, name) ? usable(data[name]) : null;
    if (value === null) {
      if (OPTIONAL_VARIABLES.includes(name)) { blanked = true; return ''; }
      if (!missing.includes(name)) missing.push(name);
      return '';
    }
    return value;
  });

  if (blanked) text = text.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1').trim();

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `missing template variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      missing,
    };
  }
  if (/\{\{|\}\}/.test(text)) {
    return { ok: false, reason: 'template contains an unreadable placeholder', missing: [] };
  }
  return { ok: true, text };
}