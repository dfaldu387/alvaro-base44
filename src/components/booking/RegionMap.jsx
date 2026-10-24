import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '@/lib/mapboxToken';
import { generateCirclePolygon } from '@/lib/geoCircle';

// Customer-facing region selection map (booking Step 1). Shows one circle
// per Service Zone (using the zone's radius_km and colour) plus one pin for
// the Main Service Centre (no circle). Customer location marker is shown
// when available. Clicking a zone marker selects it.
export default function RegionMap({ areas, selectedId, onSelect, customerLocation, radiusSettings, serviceCoverage, height = 'h-[280px] md:h-[400px]' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const centreLat = serviceCoverage?.centre?.latitude ?? radiusSettings?.service_centre_lat ?? -33.87;
  const centreLng = serviceCoverage?.centre?.longitude ?? radiusSettings?.service_centre_lng ?? 151.21;
  const extendedRadiusKm = serviceCoverage?.extended_radius_km ?? radiusSettings?.extended_radius_km ?? null;
  const maxRadiusKm = serviceCoverage?.maximum_radius_km ?? radiusSettings?.maximum_service_radius_km ?? null;

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

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
      map.addSource('customer-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('extended-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('max-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: 'extended-circle-line',
        source: 'extended-circle',
        type: 'line',
        paint: { 'line-color': '#6366f1', 'line-width': 1.5, 'line-opacity': 0.4, 'line-dasharray': [3, 3] },
      });
      map.addLayer({
        id: 'max-circle-line',
        source: 'max-circle',
        type: 'line',
        paint: { 'line-color': '#6366f1', 'line-width': 1, 'line-opacity': 0.25, 'line-dasharray': [2, 4] },
      });
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
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 6, 4],
          'circle-color': ['get', 'colour'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'zone-labels',
        source: 'zone-points',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, -1.4], 'text-anchor': 'bottom' },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 },
      });
      map.addLayer({
        id: 'centre-marker',
        source: 'centre-point',
        type: 'circle',
        paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-stroke-color': '#6366f1', 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'customer-halo',
        source: 'customer-point',
        type: 'circle',
        paint: { 'circle-radius': 18, 'circle-color': '#8b3dff', 'circle-opacity': 0.2 },
      });
      map.addLayer({
        id: 'customer-marker',
        source: 'customer-point',
        type: 'circle',
        paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#8b3dff', 'circle-stroke-width': 3 },
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
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; setMapReady(false); };
  }, [token]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;

    const circles = [];
    const points = [];
    for (const area of areas) {
      if (area.latitude == null || area.longitude == null) continue;
      if (area.active === false) continue;
      const radius = area.radius_km || 10;
      const poly = generateCirclePolygon(area.latitude, area.longitude, radius);
      circles.push({ type: 'Feature', geometry: poly, properties: { id: area.id, colour: area.colour || '#8B5CF6' } });
      points.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [area.longitude, area.latitude] },
        properties: { id: area.id, name: area.name || 'Zone', colour: area.colour || '#8B5CF6', selected: area.id === selectedId },
      });
    }
    map.getSource('zone-circles').setData({ type: 'FeatureCollection', features: circles });
    map.getSource('zone-points').setData({ type: 'FeatureCollection', features: points });
    map.getSource('centre-point').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [centreLng, centreLat] }, properties: {} }],
    });

    // Extended / maximum radius overlays around the coverage centre
    const extSource = map.getSource('extended-circle');
    if (extSource) {
      if (extendedRadiusKm && centreLat != null && centreLng != null) {
        const poly = generateCirclePolygon(centreLat, centreLng, extendedRadiusKm);
        extSource.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: poly, properties: {} }] });
      } else {
        extSource.setData({ type: 'FeatureCollection', features: [] });
      }
    }
    const maxSource = map.getSource('max-circle');
    if (maxSource) {
      if (maxRadiusKm && centreLat != null && centreLng != null) {
        const poly = generateCirclePolygon(centreLat, centreLng, maxRadiusKm);
        maxSource.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: poly, properties: {} }] });
      } else {
        maxSource.setData({ type: 'FeatureCollection', features: [] });
      }
    }

    const customerLngLat = customerLocation ? [customerLocation.lng, customerLocation.lat] : null;
    map.getSource('customer-point').setData({
      type: 'FeatureCollection',
      features: customerLngLat ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: customerLngLat }, properties: {} }] : [],
    });

    const bounds = new mapboxgl.LngLatBounds();
    for (const f of circles) for (const [lng, lat] of f.geometry.coordinates[0]) bounds.extend([lng, lat]);
    if (customerLngLat) bounds.extend(customerLngLat);
    if (centreLat != null && centreLng != null) bounds.extend([centreLng, centreLat]);
    if (extendedRadiusKm && centreLat != null && centreLng != null) {
      const extPoly = generateCirclePolygon(centreLat, centreLng, extendedRadiusKm);
      for (const [lng, lat] of extPoly.coordinates[0]) bounds.extend([lng, lat]);
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
  }, [mapReady, areas, selectedId, customerLocation, centreLat, centreLng, extendedRadiusKm, maxRadiusKm]);

  if (loading) {
    return <div className={`rounded-2xl border border-border overflow-hidden ${height} flex items-center justify-center bg-card`}><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (error) {
    return <div className={`rounded-2xl border border-border overflow-hidden ${height} flex items-center justify-center bg-card text-center p-4`}><p className="text-xs text-muted-foreground">Map unavailable.</p></div>;
  }
  return <div className={`rounded-2xl border border-border overflow-hidden ${height}`}><div ref={containerRef} className="w-full h-full" /></div>;
}