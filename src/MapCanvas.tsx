import { useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MapLibreMap, NavigationControl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import type { FeatureCollection, RouteResult } from './types';

type Props = {
  mode: 'system' | 'access' | 'route';
  provinceId: string | null;
  categories: string[];
  threshold: number;
  route: RouteResult | null;
  onProvince: (id: string, name: string) => void;
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function boundsOf(geometry: unknown): LngLatBoundsLike | null {
  const points: [number, number][] = [];
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      points.push([node[0], node[1]]);
      return;
    }
    node.forEach(walk);
  };
  walk((geometry as { coordinates?: unknown } | null)?.coordinates);
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

export default function MapCanvas({ mode, provinceId, categories, threshold, route, onProvince }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const routeSourceRef = useRef<GeoJSONSource | null>(null);
  const onProvinceRef = useRef(onProvince);
  const [loaded, setLoaded] = useState(false);
  onProvinceRef.current = onProvince;

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: container.current,
      center: [-64.5, -38.2],
      zoom: 3.25,
      minZoom: 2.8,
      maxZoom: 15,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [import.meta.env.VITE_BASEMAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: import.meta.env.VITE_BASEMAP_ATTRIBUTION || '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.53, 'raster-saturation': -0.72 } }],
      },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    map.on('load', async () => {
      map.addSource('provinces', { type: 'geojson', data: '/data/provinces.geojson' });
      map.addSource('facilities', { type: 'geojson', data: mode === 'system' ? '/data/facilities.geojson' : EMPTY as never, promoteId: 'id' });
      map.addSource('settlements', { type: 'geojson', data: mode === 'access' ? '/data/settlements.geojson' : EMPTY as never });
      map.addSource('isochrones', { type: 'geojson', data: mode === 'access' ? '/data/access-isochrones.geojson' : EMPTY as never });
      map.addSource('route', { type: 'geojson', data: EMPTY as never });
      routeSourceRef.current = map.getSource('route') as GeoJSONSource;

      map.addLayer({ id: 'province-fill', type: 'fill', source: 'provinces', paint: { 'fill-color': '#436497', 'fill-opacity': 0.035 } });
      map.addLayer({ id: 'iso-band-3', type: 'fill', source: 'isochrones', filter: ['==', ['get', 'band'], 3], paint: { 'fill-color': '#0000ff', 'fill-opacity': 0.34 } });
      map.addLayer({ id: 'iso-band-2', type: 'fill', source: 'isochrones', filter: ['==', ['get', 'band'], 2], paint: { 'fill-color': '#00ff00', 'fill-opacity': 0.34 } });
      map.addLayer({ id: 'iso-band-1', type: 'fill', source: 'isochrones', filter: ['==', ['get', 'band'], 1], paint: { 'fill-color': '#ffff00', 'fill-opacity': 0.38 } });
      map.addLayer({ id: 'iso-band-0', type: 'fill', source: 'isochrones', filter: ['==', ['get', 'band'], 0], paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.42 } });
      map.addLayer({ id: 'province-line', type: 'line', source: 'provinces', paint: { 'line-color': '#a3f5d1', 'line-opacity': 0.42, 'line-width': 0.75 } });
      map.addLayer({ id: 'province-selected', type: 'line', source: 'provinces', filter: ['==', ['get', 'province_id'], ''], paint: { 'line-color': '#a3f5d1', 'line-width': 2.5, 'line-opacity': 0.95 } });
      map.addLayer({ id: 'settlement-points', type: 'circle', source: 'settlements', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 8, 3], 'circle-color': '#a3f5d1', 'circle-opacity': 0.52, 'circle-stroke-width': 0.2, 'circle-stroke-color': '#1b2026' } });
      map.addLayer({ id: 'facility-glow', type: 'heatmap', source: 'facilities', maxzoom: 7, paint: {
        'heatmap-weight': 0.55,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.95, 7, 1.55],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 20, 7, 31],
        'heatmap-opacity': 0.76,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(67,100,151,0)', 0.22, '#436497', 0.52, '#598bca', 0.82, '#a3f5d1'],
      } });
      map.addLayer({ id: 'facility-points', type: 'circle', source: 'facilities', minzoom: 5.7, paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5.7, 1.1, 9, 2.4, 13, 4],
        'circle-color': '#d7ffed',
        'circle-opacity': 0.91,
        'circle-stroke-color': '#a3f5d1',
        'circle-stroke-width': 0.55,
      } });
      map.addLayer({ id: 'route-line-casing', type: 'line', source: 'route', paint: { 'line-color': '#1b2026', 'line-width': 7, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#a3f5d1', 'line-width': 4, 'line-opacity': 1 } });
      map.addLayer({ id: 'route-origin', type: 'circle', source: 'route', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#a3f5d1', 'circle-stroke-color': '#1b2026', 'circle-stroke-width': 2 } });

      map.on('click', 'province-fill', (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['province-fill'] })[0];
        const id = String(feature?.properties?.province_id ?? '');
        const name = String(feature?.properties?.province ?? '');
        if (id && name) {
          onProvinceRef.current(id, name);
          const bounds = boundsOf(feature.geometry);
          if (bounds) map.fitBounds(bounds, { padding: 70, maxZoom: 7.2, duration: 850 });
        }
      });
      map.on('mouseenter', 'province-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'province-fill', () => { map.getCanvas().style.cursor = ''; });
      map.fitBounds([[-74, -56], [-52, -20]], { padding: { top: 30, bottom: 30, left: 30, right: 30 }, duration: 0 });
      setLoaded(true);
    });
    return () => {
      routeSourceRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !map.isStyleLoaded()) return;
    const provinceFilter = provinceId ? ['==', ['get', 'province_id'], provinceId] : null;
    map.setFilter('province-selected', provinceFilter as never);
    const facilityFilters: unknown[] = [];
    if (provinceId) facilityFilters.push(['==', ['get', 'province_id'], provinceId]);
    if (categories.length) facilityFilters.push(['in', ['get', 'category'], ['literal', categories]]);
    const filter = facilityFilters.length ? ['all', ...facilityFilters] : null;
    map.setFilter('facility-glow', filter as never);
    map.setFilter('facility-points', filter as never);
    const accessVisible = mode === 'access';
    for (const id of ['iso-band-0', 'iso-band-1', 'iso-band-2', 'iso-band-3', 'settlement-points']) {
      map.setLayoutProperty(id, 'visibility', accessVisible ? 'visible' : 'none');
    }
    for (const id of ['facility-glow', 'facility-points']) {
      map.setLayoutProperty(id, 'visibility', mode === 'system' ? 'visible' : 'none');
    }
    for (const id of ['route-line-casing', 'route-line', 'route-origin']) {
      map.setLayoutProperty(id, 'visibility', mode === 'route' ? 'visible' : 'none');
    }
    if (mode === 'access') {
      const isoFilter: unknown[] = [];
      if (provinceId) isoFilter.push(['==', ['get', 'province_id'], provinceId]);
      if (categories.length) isoFilter.push(['in', ['get', 'category'], ['literal', categories]]);
      isoFilter.push(['==', ['get', 'threshold'], threshold]);
      for (const id of ['iso-band-0', 'iso-band-1', 'iso-band-2', 'iso-band-3']) {
        map.setFilter(id, isoFilter.length ? ['all', ...isoFilter, ['==', ['get', 'band'], Number(id.at(-1))]] as never : ['==', ['get', 'band'], Number(id.at(-1))]);
      }
    }
  }, [loaded, mode, provinceId, categories, threshold]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    if (!provinceId) {
      map.fitBounds([[-74, -56], [-52, -20]], { padding: 38, maxZoom: 3.4, duration: 650 });
      return;
    }
    fetch('/data/provinces.geojson').then((response) => response.ok ? response.json() : null).then((data) => {
      const feature = data?.features?.find((item: { properties?: { province_id?: string } }) => String(item.properties?.province_id) === provinceId);
      const bounds = feature && boundsOf(feature.geometry);
      if (bounds) map.fitBounds(bounds, { padding: 70, maxZoom: 7.2, duration: 650 });
    }).catch(() => undefined);
  }, [loaded, provinceId]);

  useEffect(() => {
    if (!loaded || !routeSourceRef.current) return;
    if (!route) {
      routeSourceRef.current.setData(EMPTY as never);
      return;
    }
    routeSourceRef.current.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: route.geometry, properties: { kind: 'route' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: route.origin }, properties: { kind: 'origin' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: route.destination }, properties: { kind: 'destination' } },
      ],
    } as never);
    const map = mapRef.current;
    const bounds = boundsOf(route.geometry);
    if (map && bounds) map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 800 });
  }, [loaded, route]);

  return <div ref={container} className="map-canvas" aria-label="Mapa interactivo de establecimientos y accesibilidad sanitaria en Argentina" />;
}
