import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '@/lib/mapboxToken';
import { generateCirclePolygon } from '@/lib/geoCircle';

// Small live Mapbox preview for the zone editor's Centre & radius section.
// Shows the zone centre pin and coloured radius circle. Updates
// immediately when centre, radius, or colour changes.
export default function ZoneMapPreview({ latitude, longitude, radiusKm, colour, name }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const hasCoords = latitude != null && longitude != null;
  const r = radiusKm || 10;
  const zoneColour = colour || '#6f22cf';
  const zoom = r >= 20 ? 9 : r >= 10 ? 10 : 11;

  // Fetch token once
  useEffect(() => {
    let cancelled = false;
    getMapboxToken()
      .then((t) => { if (!cancelled) { setToken(t); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // Initialize map when token and coords are available
  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current || !hasCoords) return;
    mapboxgl.accessToken = token;
    let map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [longitude, latitude],
        zoom,
      });
    } catch (e) {
      setError(e);
      return;
    }
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('zone', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'zone-fill',
        source: 'zone',
        type: 'fill',
        paint: { 'fill-color': zoneColour, 'fill-opacity': 0.2 },
      });
      map.addLayer({
        id: 'zone-outline',
        source: 'zone',
        type: 'line',
        paint: { 'line-color': zoneColour, 'line-width': 2 },
      });
      map.addLayer({
        id: 'zone-centre',
        source: 'zone',
        type: 'circle',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4, 'circle-color': zoneColour, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });
      setMapReady(true);
    });

    const ro = new ResizeObserver(() => { mapRef.current?.resize(); });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [token, hasCoords]);

  // Update circle data when coords or radius change
  useEffect(() => {
    if (!mapReady || !hasCoords) return;
    const map = mapRef.current;
    const polygon = generateCirclePolygon(latitude, longitude, r);
    map.getSource('zone').setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: polygon, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: {} },
      ],
    });
    map.flyTo({ center: [longitude, latitude], zoom, duration: 400 });
  }, [mapReady, latitude, longitude, r]);

  // Update colour
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    map.setPaintProperty('zone-fill', 'fill-color', zoneColour);
    map.setPaintProperty('zone-outline', 'line-color', zoneColour);
    map.setPaintProperty('zone-centre', 'circle-color', zoneColour);
  }, [mapReady, zoneColour]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 h-[200px] flex items-center justify-center bg-zinc-50">
        <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 h-[200px] flex items-center justify-center bg-zinc-50 text-center px-4">
        <p className="text-xs text-zinc-400">Map unavailable. Check MAPBOX_ACCESS_TOKEN.</p>
      </div>
    );
  }

  if (!hasCoords) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 h-[200px] flex items-center justify-center text-center px-4">
        <div>
          <p className="text-xs font-medium text-zinc-500">No location set</p>
          <p className="text-[11px] text-zinc-400 mt-0.5">Enter a centre suburb and click "Find location" to see the zone on the map.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 overflow-hidden h-[200px]">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}