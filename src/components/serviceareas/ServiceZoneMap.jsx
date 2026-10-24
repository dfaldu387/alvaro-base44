import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '@/lib/mapboxToken';

const SYDNEY = { lng: 151.21, lat: -33.87 };

// Admin Service Zone map. Shows zone markers and labels only — Service
// Zones are scheduling/routing labels, not coverage circles. Coverage is
// defined globally in Booking Rules → Service Coverage. Supports zone
// selection, draft-zone preview, fly-to, and fit-to-zone.
export default function ServiceZoneMap({ areas, selectedId, onSelect, draftZone, flyTrigger = 0 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const fitRef = useRef(false);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const draftZoneRef = useRef(draftZone);
  useEffect(() => { draftZoneRef.current = draftZone; }, [draftZone]);

  useEffect(() => {
    let cancelled = false;
    getMapboxToken()
      .then((t) => { if (!cancelled) { setToken(t); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    let map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [SYDNEY.lng, SYDNEY.lat],
        zoom: 10,
      });
    } catch (e) {
      setError(e);
      return;
    }
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizeRoll: true }), 'bottom-right');

    map.on('load', () => {
      map.addSource('zone-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: 'zone-markers',
        source: 'zone-points',
        type: 'circle',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 7, 5],
          'circle-color': ['get', 'colour'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      map.addLayer({
        id: 'zone-labels',
        source: 'zone-points',
        type: 'symbol',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, -1.4],
          'text-anchor': 'bottom',
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 },
      });

      map.on('click', 'zone-markers', (e) => {
        if (e.features.length > 0) onSelectRef.current?.(e.features[0].properties.id);
      });
      map.on('mouseenter', 'zone-markers', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'zone-markers', () => { map.getCanvas().style.cursor = ''; });

      setMapReady(true);
    });

    const ro = new ResizeObserver(() => { mapRef.current?.resize(); });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; setMapReady(false); fitRef.current = false; };
  }, [token]);

  useEffect(() => {
    if (!mapReady || flyTrigger <= 0) return;
    const map = mapRef.current;
    const dz = draftZoneRef.current;
    if (!map || !dz || dz.latitude == null || dz.longitude == null) return;
    map.flyTo({ center: [dz.longitude, dz.latitude], zoom: 11, duration: 800, essential: true });
  }, [flyTrigger, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    const points = [];

    for (const area of areas) {
      if (draftZone && area.id === draftZone.id) continue;
      if (area.latitude == null || area.longitude == null) continue;
      points.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [area.longitude, area.latitude] },
        properties: {
          id: area.id,
          name: area.name || 'Untitled zone',
          colour: area.colour || '#7c3aed',
          selected: area.id === selectedId,
          draft: false,
          active: area.active !== false,
        },
      });
    }

    if (draftZone && draftZone.id) {
      if (draftZone.latitude != null && draftZone.longitude != null) {
        points.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [draftZone.longitude, draftZone.latitude] },
          properties: {
            id: draftZone.id,
            name: draftZone.name || 'Untitled zone',
            colour: draftZone.colour || '#7c3aed',
            selected: true,
            draft: true,
            active: draftZone.active !== false,
          },
        });
      }
    }

    map.getSource('zone-points').setData({ type: 'FeatureCollection', features: points });

    if (!fitRef.current && points.length > 0) {
      fitRef.current = true;
      const bounds = new mapboxgl.LngLatBounds();
      for (const p of points) bounds.extend(p.geometry.coordinates);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
    }
  }, [mapReady, areas, selectedId, draftZone]);

  const fitToZone = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const zone = draftZone || areas.find((a) => a.id === selectedId);
    if (!zone || zone.latitude == null || zone.longitude == null) return;
    map.flyTo({ center: [zone.longitude, zone.latitude], zoom: 12, duration: 600, essential: true });
  }, [mapReady, draftZone, selectedId, areas]);

  if (loading) {
    return (
      <div className="h-full min-h-[300px] flex items-center justify-center bg-[#0a0a0c]">
        <div className="w-7 h-7 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full min-h-[300px] flex items-center justify-center bg-[#0a0a0c] p-6 text-center">
        <div>
          <p className="text-sm font-medium text-zinc-400">Map unavailable</p>
          <p className="text-xs text-zinc-600 mt-1">Check that MAPBOX_ACCESS_TOKEN is set with a valid token.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[300px] bg-[#0a0a0c]">
      <div ref={containerRef} className="absolute inset-0" />
      <button
        onClick={fitToZone}
        className="absolute top-3 right-3 z-10 rounded-lg bg-[#1a1a1e] border border-[#27272a] px-3 py-1.5 text-xs font-semibold text-zinc-300 shadow-lg hover:bg-[#222226]"
      >
        Fit to zone
      </button>
    </div>
  );
}