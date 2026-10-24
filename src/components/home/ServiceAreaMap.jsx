import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '@/lib/mapboxToken';
import { generateCirclePolygon } from '@/lib/geoCircle';

function daysLabel(area) {
  const days = area.service_days || [];
  if (!days.length) return 'By appointment';
  return days.join(' & ');
}

// Customer-facing service area map (homepage). Shows one circle per
// active Service Zone (using the zone's radius_km and colour) plus one
// pin for the Main Service Centre (no circle). Zone popups link to booking.
export default function ServiceAreaMap({ areas, radiusSettings }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const centreLat = radiusSettings?.service_centre_lat ?? -33.87;
  const centreLng = radiusSettings?.service_centre_lng ?? 151.21;

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
        center: [centreLng, centreLat],
        zoom: 10,
      });
    } catch (e) {
      // No WebGL in this browser/device: show the fallback instead of crashing the page.
      setError(e);
      return;
    }
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('zone-circles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('zone-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('centre-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: 'zone-circles-fill',
        source: 'zone-circles',
        type: 'fill',
        paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'zone-circles-outline',
        source: 'zone-circles',
        type: 'line',
        paint: { 'line-color': ['get', 'colour'], 'line-width': 2, 'line-opacity': 0.8 },
      });
      map.addLayer({
        id: 'zone-markers',
        source: 'zone-points',
        type: 'circle',
        paint: { 'circle-radius': 5, 'circle-color': ['get', 'colour'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
      map.addLayer({
        id: 'zone-labels',
        source: 'zone-points',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, -1.4], 'text-anchor': 'bottom' },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 },
      });
      map.addLayer({
        id: 'centre-marker',
        source: 'centre-point',
        type: 'circle',
        paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-stroke-color': '#6366f1', 'circle-stroke-width': 3 },
      });

      const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '220px' });
      map.on('click', 'zone-markers', (e) => {
        if (e.features.length === 0) return;
        const props = e.features[0].properties;
        const area = areas.find(a => a.id === props.id);
        if (!area) return;
        popup.setLngLat(e.lngLat).setHTML(
          `<div style="font-family:Inter,sans-serif;padding:4px">` +
          `<p style="font-weight:600;color:#fff;margin:0 0 4px">${area.name}</p>` +
          `<p style="font-size:12px;color:#aaa;margin:0 0 8px">${daysLabel(area)}</p>` +
          `<a href="/book?area=${area.id}" style="font-size:12px;color:#fff;font-weight:600;text-decoration:none;border-bottom:1px solid rgba(255,255,255,0.35);padding-bottom:1px">View availability →</a>` +
          `</div>`
        ).addTo(map);
      });
      map.on('mouseenter', 'zone-markers', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'zone-markers', () => { map.getCanvas().style.cursor = ''; });

      setMapReady(true);
    });

    const ro = new ResizeObserver(() => { mapRef.current?.resize(); });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; setMapReady(false); };
  }, [token]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;

    const circles = [];
    const points = [];
    for (const area of areas) {
      if (area.latitude == null || area.longitude == null) continue;
      const radius = area.radius_km || 10;
      const poly = generateCirclePolygon(area.latitude, area.longitude, radius);
      circles.push({ type: 'Feature', geometry: poly, properties: { id: area.id, colour: area.colour || '#8B5CF6' } });
      points.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [area.longitude, area.latitude] },
        properties: { id: area.id, name: area.name || 'Zone', colour: area.colour || '#8B5CF6' },
      });
    }
    map.getSource('zone-circles').setData({ type: 'FeatureCollection', features: circles });
    map.getSource('zone-points').setData({ type: 'FeatureCollection', features: points });
    map.getSource('centre-point').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [centreLng, centreLat] }, properties: {} }],
    });

    const bounds = new mapboxgl.LngLatBounds();
    for (const f of circles) for (const [lng, lat] of f.geometry.coordinates[0]) bounds.extend([lng, lat]);
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
  }, [mapReady, areas, centreLat, centreLng]);

  if (loading) {
    return <div className="rounded-3xl border border-border overflow-hidden h-[420px] md:h-[520px] flex items-center justify-center bg-card"><div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (error) {
    return <div className="rounded-3xl border border-border overflow-hidden h-[420px] md:h-[520px] flex items-center justify-center bg-card text-center p-6"><p className="text-sm text-muted-foreground">Map unavailable. Please try again later.</p></div>;
  }
  return <div className="rounded-3xl border border-border overflow-hidden h-[420px] md:h-[520px]"><div ref={containerRef} className="w-full h-full" /></div>;
}