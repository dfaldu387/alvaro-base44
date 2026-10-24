import { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';

// The device is read every 125 s (just over the server's 120 s lookup interval, so a
// reading is never throttled by timing alone). Foreground only: a browser page cannot
// read the position once it is in the background.
const CAPTURE_MS = 125000;

const call = (payload) => base44.functions.invoke('liveLocation', payload).then((r) => r.data).catch(() => null);

const readPosition = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy, taken_at: new Date(p.timestamp).toISOString() }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
});

/**
 * The barber's "Share my location for today" switch.
 *   enabled   - today's route is on screen
 *   inTransit - the current stop is on_the_way (the ONLY time the device is read)
 *   dayEnded  - every stop is completed or skipped (the server has already switched it off)
 */
export default function useLiveLocation({ enabled, inTransit, dayEnded }) {
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [lookups, setLookups] = useState(0);
  const sharingRef = useRef(false);
  sharingRef.current = sharing;

  const refresh = useCallback(async () => {
    const s = await call({ action: 'status' });
    if (s) { setSharing(!!s.sharing); setLookups(Number(s.lookups_today || 0)); }
  }, []);

  useEffect(() => { if (enabled) refresh(); else setSharing(false); }, [enabled, refresh]);
  useEffect(() => { if (dayEnded && sharingRef.current) refresh(); }, [dayEnded, refresh]);

  const toggle = useCallback(async (next) => {
    setNote(''); setBusy(true);
    if (!next) {
      const r = await call({ action: 'off' });
      if (r && r.sharing === false) setSharing(false);
      setBusy(false);
      return;
    }
    // Ask the phone first: a switch that is on but can never read anything would mislead.
    const first = await readPosition();
    if (!first) { setNote('Allow location for this site in your phone settings to share it.'); setBusy(false); return; }
    const r = await call({ action: 'on' });
    if (r?.sharing) setSharing(true);
    else if (r?.reason === 'no_stops_left_today') setNote('There are no stops left today.');
    setBusy(false);
  }, []);

  // Read the device only while sharing is on, the page is open and a stop is on the way.
  useEffect(() => {
    if (!sharing || !inTransit) return undefined;
    let cancelled = false;
    const send = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const p = await readPosition();
      if (!p || cancelled) return; // no position is normal
      const r = await call({ action: 'update', ...p });
      if (r?.lookups_made) setLookups((n) => n + r.lookups_made);
    };
    send();
    const timer = setInterval(send, CAPTURE_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sharing, inTransit]);

  return { sharing, busy, note, lookups, toggle, refresh };
}