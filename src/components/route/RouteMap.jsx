import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { base44 } from '@/api/base44Client';
import { getMapboxToken } from '@/lib/mapboxToken';
import { decodePolyline, legFrom, driveLabel } from '@/lib/routePolyline';
import { decimalToLabel } from '@/lib/timeUtils';
import { Loader2, MapPin, Navigation, Clock, X } from 'lucide-react';

const PURPLE = '#5647f5';

// The road route for the day, in the Calendar's order. Google Routes measures it
// and returns the road geometry; the app's own map draws it. Numbers on the map
// are the same numbers as the timeline below, so a stop is never ambiguous.
export default function RouteMap({ stops, start, driveTimes, selectedId, onSelect, className = '' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const fittedKeyRef = useRef(null);
  const [token, setToken] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // What the route is: the barber's start, then each stop in order. Any change to
  // an address, a coordinate, the order or the day re-asks Google.
  const routeKey = useMemo(() => [
    start ? `${start.lat},${start.lng},${start.address || ''}` : 'no-start',
    ...stops.map((s) => `${s.id}:${s.address_lat ?? ''},${s.address_lng ?? ''}:${s.address || ''}`),
  ].join('|'), [stops, start]);

  useEffect(() => {
    let cancelled = false;
    getMapboxToken()
      .then((t) => { if (!cancelled) setToken(t); })
      .catch((e) => { if (!cancelled) setMapError(e); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!stops.length) return undefined;
    let cancelled = false;
    setRouteLoading(true);
    base44.functions.invoke('googleRouteMap', {
      start: start?.lat != null && start?.lng != null ? { lat: start.lat, lng: start.lng } : null,
      stops: stops.map((s) => ({
        id: s.id,
        lat: s.address_lat ?? null,
        lng: s.address_lng ?? null,
        address: s.address || '',
      })),
    })
      .then((res) => { if (!cancelled) setGeometry(res?.data || { ok: false, reason: 'failed' }); })
      .catch(() => { if (!cancelled) setGeometry({ ok: false, reason: 'failed' }); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // ── The map itself ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return undefined;
    mapboxgl.accessToken = token;
    let map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [151.2, -33.87],
        zoom: 10,
        attributionControl: false,
      });
    } catch (e) {
      setMapError(e);
      return undefined;
    }
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      map.addSource('route-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'route-line-casing',
        type: 'line',
        source: 'route-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'route-line-path',
        type: 'line',
        source: 'route-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PURPLE, 'line-width': 5 },
      });
      map.addSource('route-start', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'route-start-dot',
        type: 'circle',
        source: 'route-start',
        paint: { 'circle-radius': 7, 'circle-color': '#11111a', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' },
      });
      map.on('click', () => onSelect?.(null));
      setMapReady(true);
    });

    return () => { map.remove(); mapRef.current = null; setMapReady(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Draw the route and its numbered stops ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const located = (geometry?.stops || []).filter((p) => p.lat != null && p.lng != null);
    const road = geometry?.ok ? decodePolyline(geometry.polyline) : [];
    // No road geometry (still loading, or the Routes API refused): the stops are
    // still shown in order, joined plainly, so the day is never blank.
    const path = road.length > 1 ? road : located.map((p) => [p.lng, p.lat]);
    const startPoint = start?.lat != null && start?.lng != null ? [start.lng, start.lat] : null;

    map.getSource('route-line')?.setData({
      type: 'FeatureCollection',
      features: path.length > 1
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: path }, properties: {} }]
        : [],
    });
    map.getSource('route-start')?.setData({
      type: 'FeatureCollection',
      features: startPoint
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: startPoint }, properties: {} }]
        : [],
    });

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    located.forEach((point) => {
      const n = stops.findIndex((s) => s.id === point.id) + 1;
      if (!n) return;
      const stop = stops[n - 1];
      const isSelected = stop.id === selectedId;
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = String(n);
      el.setAttribute('aria-label', `Stop ${n}: ${stop.clientName || ''}`);
      Object.assign(el.style, {
        width: isSelected ? '34px' : '30px',
        height: isSelected ? '34px' : '30px',
        borderRadius: '9999px',
        background: isSelected ? '#11111a' : PURPLE,
        color: '#fff',
        fontSize: '13px',
        fontWeight: '700',
        border: `2px solid ${isSelected ? PURPLE : '#fff'}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: '1',
      });
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onSelect?.(stop.id);
      });
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map));
    });

    // Frame the whole route once, when the route itself changes. Picking a stop
    // must never throw away the zoom the barber has set.
    const all = [...path, ...(startPoint ? [startPoint] : [])];
    const fitKey = `${routeKey}|${geometry?.ok ? 'road' : 'points'}`;
    if (all.length && fittedKeyRef.current !== fitKey) {
      fittedKeyRef.current = fitKey;
      const bounds = all.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(all[0], all[0]));
      map.fitBounds(bounds, { padding: { top: 60, bottom: 70, left: 50, right: 60 }, maxZoom: 14, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, mapReady, selectedId, routeKey]);

  const selected = stops.find((s) => s.id === selectedId) || null;
  const selectedNumber = selected ? stops.findIndex((s) => s.id === selected.id) + 1 : null;
  const nextStop = selected ? stops[selectedNumber] : null;
  // The drive shown for a stop is the one it causes (to the next stop); the last
  // stop has none, so it shows the drive that brings the barber to it.
  const outboundLeg = selected ? legFrom(geometry?.legs, selectedNumber - 1) : null;
  const inboundLeg = selected ? legFrom(geometry?.legs, selectedNumber - 2) : null;
  const shownLeg = outboundLeg || inboundLeg;
  const fallbackLeg = selected && nextStop ? driveTimes?.[`${selected.id}_${nextStop.id}`] : null;
  const selectedDrive = driveLabel(shownLeg)
    || (fallbackLeg?.state === 'ok'
      ? `${fallbackLeg.mins} min${fallbackLeg.km ? ` · ${fallbackLeg.km} km` : ''}`
      : null);
  const driveSuffix = outboundLeg
    ? (nextStop ? ` to next stop (${decimalToLabel(nextStop.apptStart)})` : '')
    : (selectedNumber > 1 ? ' from previous stop' : ' from start location');

  const summary = geometry?.ok && geometry.total_minutes != null
    ? `${geometry.total_km ?? '—'} km · ${Math.floor(geometry.total_minutes / 60) > 0 ? `${Math.floor(geometry.total_minutes / 60)}h ` : ''}${geometry.total_minutes % 60}m driving`
    : null;

  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-card ${className}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          <span className="text-[12px] font-semibold text-foreground">Route map</span>
          {routeLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {summary || (geometry && !geometry.ok ? 'Road route unavailable' : `${stops.length} stops`)}
        </span>
      </div>

      <div className="relative">
        <div ref={containerRef} className="h-[320px] w-full sm:h-[360px]" />

        {(!mapReady || mapError) && (
          <div className="absolute inset-0 flex items-center justify-center bg-secondary text-center">
            <p className="px-6 text-[11px] text-muted-foreground">
              {mapError ? 'The map could not be shown here. Drive times are still listed below.' : 'Loading map…'}
            </p>
          </div>
        )}

        {selected && (
          <div className="absolute inset-x-2 bottom-2 rounded-xl border border-border bg-card/98 p-3 shadow-lg backdrop-blur">
            <div className="mb-1 flex items-start gap-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                {selectedNumber}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold leading-tight text-foreground">
                  {decimalToLabel(selected.apptStart)} · {selected.clientName}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" /> {selected.duration} min · {(selected.services || []).filter(Boolean).join(', ') || 'Service'}
                </p>
                {selected.address && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> <span className="break-words">{selected.address}</span>
                  </p>
                )}
                {selectedDrive && (
                  <p className="mt-1 text-[11px] font-semibold text-foreground">
                    {selectedDrive}{driveSuffix}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => onSelect?.(null)} aria-label="Close stop details" className="rounded-full p-1 text-muted-foreground active:opacity-60">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                selected.address_lat != null && selected.address_lng != null
                  ? `${selected.address_lat},${selected.address_lng}`
                  : selected.address || '',
              )}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2 text-[12px] font-bold text-white active:scale-[0.98]"
            >
              <Navigation className="h-3.5 w-3.5" /> Navigate
            </a>
          </div>
        )}
      </div>
    </div>
  );
}