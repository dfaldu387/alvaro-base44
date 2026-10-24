import { useCallback, useState } from 'react';

/**
 * Copies a client's exact service address (so it can be pasted straight into Google Maps
 * or Waze), with a brief confirmation for whatever shows the button.
 */
export default function useCopyAddress() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (address) => {
    const text = String(address || '').trim();
    if (!text) return false;

    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) {
      // Older mobile browsers have no clipboard API: fall back to the selection copy.
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; } finally { el.remove(); }
    }

    // A refused clipboard is not a failure the barber can act on, so it stays silent.
    if (!ok) return false;
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    return true;
  }, []);

  return { copied, copy };
}