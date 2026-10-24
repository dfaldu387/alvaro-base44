// Opening a saved appointment address in a maps app.
//
// Every link is built from the address the BOOKING was saved with (never the
// client's profile), encoded exactly once, and uses each provider's universal link:
// the installed app opens when there is one and the web map when there is not, so
// the same link works on iPhone, Android and desktop.

export const NAV_PROVIDERS = [
  { key: 'google', label: 'Google Maps' },
  { key: 'apple', label: 'Apple Maps' },
  { key: 'waze', label: 'Waze' },
];

export function mapsUrl(address, provider = 'google') {
  const text = String(address || '').trim();
  if (!text) return null;
  const q = encodeURIComponent(text);
  if (provider === 'apple') return `https://maps.apple.com/?daddr=${q}`;
  if (provider === 'waze') return `https://waze.com/ul?q=${q}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

/**
 * Which app Navigate opens when the barber does not choose one: Apple Maps on an
 * iPhone or iPad (it is already installed there), Google Maps everywhere else.
 */
export function defaultNavProvider() {
  if (typeof navigator === 'undefined') return 'google';
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '') ? 'apple' : 'google';
}

/** The navigation link for an address, ready for an anchor's href. */
export function navigateHref(address, provider) {
  return mapsUrl(address, provider || defaultNavProvider());
}