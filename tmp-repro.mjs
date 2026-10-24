import { evaluateSchedule } from './base44/shared/reshuffleEngine.ts';

const drive = () => 15; // 15 minutes between the two clients
const base = [
  { id: 'a1', clientName: 'A1', start: 9.75, durationHours: 35 / 60, windowStart: null, windowEnd: null, anchor: true, anchorReason: 'confirmed', block: false, candidate: false, lat: -33.8, lng: 151.2 },
  { id: 'a2', clientName: 'A2', start: 10 + 55 / 60, durationHours: 30 / 60, windowStart: null, windowEnd: null, anchor: false, anchorReason: null, block: false, candidate: false, lat: -33.81, lng: 151.21 },
];
const show = (label, r) => console.log(label, '->', r.changes.map(c => `${c.booking_request_id} ${c.from_label} -> ${c.to_label}`), 'idle', r.current.totalIdleMinutes, '->', r.proposed.totalIdleMinutes);

show('flexible', evaluateSchedule(base, 8, 21, drive, {}));
show('window 10:30-14:00', evaluateSchedule(base.map(i => i.id === 'a2' ? { ...i, windowStart: 10.5, windowEnd: 14 } : i), 8, 21, drive, {}));
show('window pinned 10:55', evaluateSchedule(base.map(i => i.id === 'a2' ? { ...i, windowStart: 10 + 55 / 60, windowEnd: 14 } : i), 8, 21, drive, {}));
show('first carries 20min buffer', evaluateSchedule(base.map(i => i.id === 'a1' ? { ...i, durationHours: 55 / 60 } : i), 8, 21, drive, {}));
show('second is anchor (no move)', evaluateSchedule(base.map(i => i.id === 'a2' ? { ...i, anchor: true, anchorReason: 'locked' } : i), 8, 21, drive, {}));