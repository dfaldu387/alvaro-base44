import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '@/lib/mapboxToken';
import { generateCirclePolygon } from '@/lib/geoCircle';
import { MapPin } from 'lucide-react';

// Centre column — Mapbox map showing one circle per zone (using the zone's
// radius_km and colour) and one pin for the Main Service Centre (no circle).
// Optional extended/max radius overlays around the service centre, toggled
// by the admin. Legend overlay in top-left.
export default function CoverageMap({ areas, selectedId, onSelect, draftZone, centre, flyTrigger = 0, showExtended = false, showMax = false, extendedRadiusKm = 25, maxRadiusKm = 35 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const fitRef = useRef(false);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  const draftRef = useRef(draftZone);
  useEffect(() => { draftRef.current = draftZone; }, [draftZone]);

  useEffect(() => {
    let cancelled = false;
    getMapboxToken()
      .then((t) => { if (!cancelled) { setToken(t); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const setupLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (!map.getSource('zone-circles')) {
      map.addSource('zone-circles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('zone-points')) {
      map.addSource('zone-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('centre-point')) {
      map.addSource('centre-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('extended-circle')) {
      map.addSource('extended-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('max-circle')) {
      map.addSource('max-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (!map.getLayer('zone-circles-fill')) {
      map.addLayer({ id: 'zone-circles-fill', source: 'zone-circles', type: 'fill', paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.12 } });
    }
    if (!map.getLayer('zone-circles-outline')) {
      map.addLayer({ id: 'zone-circles-outline', source: 'zone-circles', type: 'line', paint: { 'line-color': ['get', 'colour'], 'line-width': 2, 'line-opacity': 0.8 } });
    }
    if (!map.getLayer('extended-circle-line')) {
      map.addLayer({ id: 'extended-circle-line', source: 'extended-circle', type: 'line', paint: { 'line-color': '#6366f1', 'line-width': 1.5, 'line-opacity': 0.5 } });
    }
    if (!map.getLayer('max-circle-line')) {
      map.addLayer({ id: 'max-circle-line', source: 'max-circle', type: 'line', paint: { 'line-color': '#6366f1', 'line-width': 1.5, 'line-opacity': 0.35, 'line-dasharray': [4, 4] } });
    }
    if (!map.getLayer('zone-markers')) {
      map.addLayer({ id: 'zone-markers', source: 'zone-points', type: 'circle', paint: { 'circle-radius': ['case', ['get', 'selected'], 7, 5], 'circle-color': ['get', 'colour'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    }
    if (!map.getLayer('zone-labels')) {
      map.addLayer({ id: 'zone-labels', source: 'zone-points', type: 'symbol', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, -1.4], 'text-anchor': 'bottom' }, paint: { 'text-color': '#18181b', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    }
    if (!map.getLayer('centre-marker')) {
      map.addLayer({ id: 'centre-marker', source: 'centre-point', type: 'circle', paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-stroke-color': '#6366f1', 'circle-stroke-width': 3 } });
    }

    if (!map._zoneClickBound) {
      map.on('click', 'zone-markers', (e) => { if (e.features.length > 0) onSelectRef.current?.(e.features[0].properties.id); });
      map.on('mouseenter', 'zone-markers', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'zone-markers', () => { map.getCanvas().style.cursor = ''; });
      map._zoneClickBound = true;
    }
  }, []);

  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return;

    console.log("[CoverageMap] container", containerRef.current);
    console.log("[CoverageMap] dimensions", {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    console.log("[CoverageMap] token present", !!token);

    mapboxgl.accessToken = token;
    let map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: centre ? [centre.lng, centre.lat] : [151.21, -33.87],
        zoom: 10,
      });
    } catch (e) {
      setError(e);
      return;
    }
    mapRef.current = map;
    console.log("[CoverageMap] map created");
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    map.on('load', () => {
      console.log("[CoverageMap] map loaded");
      setupLayers();
      setMapReady(true);
      setTimeout(() => mapRef.current?.resize(), 50);
      setTimeout(() => mapRef.current?.resize(), 200);
    });
    map.on('error', (e) => console.error("[CoverageMap] map error", e));
    map.on('styledata', () => { if (map.isStyleLoaded()) setupLayers(); });

    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
      setTimeout(() => mapRef.current?.resize(), 50);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      fitRef.current = false;
    };
  }, [token]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;

    const circles = [];
    const points = [];
    for (const area of areas) {
      const zone = draftRef.current && area.id === draftRef.current.id ? draftRef.current : area;
      if (zone.latitude == null || zone.longitude == null) continue;
      const radius = zone.radius_km || 10;
      const colour = zone.colour || '#8B5CF6';
      const poly = generateCirclePolygon(zone.latitude, zone.longitude, radius);
      circles.push({ type: 'Feature', geometry: poly, properties: { id: zone.id, name: zone.name || 'Zone', colour, selected: zone.id === selectedId } });
      points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [zone.longitude, zone.latitude] }, properties: { id: zone.id, name: zone.name || 'Zone', colour, selected: zone.id === selectedId } });
    }

    const dz = draftRef.current;
    if (dz && String(dz.id).startsWith('new-') && dz.latitude != null && dz.longitude != null) {
      const radius = dz.radius_km || 10;
      const colour = dz.colour || '#8B5CF6';
      const poly = generateCirclePolygon(dz.latitude, dz.longitude, radius);
      circles.push({ type: 'Feature', geometry: poly, properties: { id: dz.id, name: dz.name || 'New zone', colour, selected: true } });
      points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [dz.longitude, dz.latitude] }, properties: { id: dz.id, name: dz.name || 'New zone', colour, selected: true } });
    }

    const circlesSource = map.getSource('zone-circles');
    if (circlesSource) circlesSource.setData({ type: 'FeatureCollection', features: circles });
    const pointsSource = map.getSource('zone-points');
    if (pointsSource) pointsSource.setData({ type: 'FeatureCollection', features: points });
    const centreSource = map.getSource('centre-point');
    if (centreSource) {
      centreSource.setData({ type: 'FeatureCollection', features: centre ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [centre.lng, centre.lat] }, properties: {} }] : [] });
    }

    // Extended / max radius overlays around the service centre
    const extSource = map.getSource('extended-circle');
    if (extSource) {
      if (showExtended && centre && extendedRadiusKm) {
        const poly = generateCirclePolygon(centre.lat, centre.lng, extendedRadiusKm);
        extSource.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: poly, properties: {} }] });
      } else {
        extSource.setData({ type: 'FeatureCollection', features: [] });
      }
    }
    const maxSource = map.getSource('max-circle');
    if (maxSource) {
      if (showMax && centre && maxRadiusKm) {
        const poly = generateCirclePolygon(centre.lat, centre.lng, maxRadiusKm);
        maxSource.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: poly, properties: {} }] });
      } else {
        maxSource.setData({ type: 'FeatureCollection', features: [] });
      }
    }

    if (!fitRef.current && (circles.length > 0 || centre)) {
      fitRef.current = true;
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of circles) for (const [lng, lat] of f.geometry.coordinates[0]) bounds.extend([lng, lat]);
      if (centre) bounds.extend([centre.lng, centre.lat]);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
    }
  }, [mapReady, areas, selectedId, centre, draftZone, showExtended, showMax, extendedRadiusKm, maxRadiusKm]);

  useEffect(() => {
    if (!mapReady || flyTrigger <= 0) return;
    const dz = draftRef.current;
    if (!mapRef.current || !dz || dz.latitude == null || dz.longitude == null) return;
    mapRef.current.flyTo({ center: [dz.longitude, dz.latitude], zoom: 11, duration: 800, essential: true });
  }, [flyTrigger, mapReady]);

  const legendAreas = areas.filter(a => a.active !== false && a.latitude != null);

  if (loading) return <div className="flex items-center justify-center w-full bg-zinc-100" style={{ minHeight: 600 }}><div className="w-7 h-7 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" /></div>;
  if (error) return <div className="flex items-center justify-center w-full bg-zinc-100 p-6 text-center" style={{ minHeight: 600 }}><p className="text-sm text-zinc-500">Map unavailable. Check MAPBOX_ACCESS_TOKEN.</p></div>;

  return (
    <div className="relative w-full overflow-hidden bg-zinc-100" style={{ height: 'calc(100vh - 200px)', minHeight: 600 }}>
      <div ref={containerRef} className="w-full h-full" />
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 rounded-lg bg-white/95 border border-zinc-200 shadow-sm px-3 py-2 space-y-1 max-w-[200px]">
        {centre && (
          <div className="flex items-center gap-2 text-xs text-zinc-900">
            <span className="w-3 h-3 rounded-full bg-white border-2 border-[#6366f1] shrink-0" />
            <span>Coverage Centre</span>
          </div>
        )}
        {legendAreas.map(a => (
          <div key={a.id} className="flex items-center gap-2 text-xs text-zinc-900">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: a.colour || '#8B5CF6' }} />
            <span className="truncate">{a.name} ({a.radius_km || 10} km)</span>
          </div>
        ))}
        {showExtended && (
          <div className="flex items-center gap-2 text-xs text-zinc-600 pt-1 border-t border-zinc-200">
            <span className="w-3 h-0.5 bg-[#6366f1] shrink-0" />
            <span>Extended ({extendedRadiusKm} km)</span>
          </div>
        )}
        {showMax && (
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <span className="w-3 flex shrink-0 gap-0.5"><span className="w-1 h-0.5 bg-[#6366f1]" /><span className="w-1.5 h-0.5 bg-[#6366f1]" /><span className="w-0.5 h-0.5 bg-[#6366f1]" /></span>
            <span>Maximum ({maxRadiusKm} km)</span>
          </div>
        )}
      </div>
    </div>
  );
}