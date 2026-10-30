import { useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MapLibreMap, NavigationControl, Popup, ScaleControl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import type { FeatureCollection, RouteResult } from './types';

type Props = {
  active?: boolean;
  mode: 'system' | 'access' | 'route';
  provinceId: string | null;
  categories: string[];
  threshold: number;
  route: RouteResult | null;
  onProvince: (id: string, name: string) => void;
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const motionDuration = (duration: number) => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
async function accessChunk(url: string): Promise<FeatureCollection> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo cargar ${url} (HTTP ${response.status})`);
  const bytes = await response.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  const isGzip = header[0] === 0x1f && header[1] === 0x8b;
  if (isGzip) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede descomprimir los datos del mapa');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).json() as FeatureCollection;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as FeatureCollection;
}

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

export default function MapCanvas({ active = true, mode, provinceId, categories, threshold, route, onProvince }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const routeSourceRef = useRef<GeoJSONSource | null>(null);
  const onProvinceRef = useRef(onProvince);
  const [loaded, setLoaded] = useState(false);
  const [accessStatus, setAccessStatus] = useState<{ kind: 'loading' | 'error'; message: string } | null>(null);
  onProvinceRef.current = onProvince;

  useEffect(() => {
    if (!active || !container.current || mapRef.current) return;
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
        layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: {
          'raster-opacity': 0.76,
          'raster-saturation': -1,
          'raster-contrast': 0.22,
          'raster-brightness-min': 0.02,
          'raster-brightness-max': 0.34,
        } }],
      },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;
    const reportZoom = () => window.dispatchEvent(new CustomEvent('radio-map-zoom', { detail: map.getZoom() }));
    map.on('zoom', reportZoom);
    map.on('load', reportZoom);

    const command = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === 'zoom-in') map.zoomIn({ duration: 180 });
      if (action === 'zoom-out') map.zoomOut({ duration: 180 });
      if (action === 'reset') map.fitBounds([[-74, -56], [-52, -20]], { padding: 38, maxZoom: 3.4, duration: motionDuration(500) });
      if (action === 'pan') map.dragPan.isEnabled() ? map.dragPan.disable() : map.dragPan.enable();
      if (action === 'scale') {
        const scale = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-scale');
        if (scale) scale.style.visibility = scale.style.visibility === 'visible' ? 'hidden' : 'visible';
      }
    };
    window.addEventListener('radio-map-command', command);

    map.on('load', async () => {
      map.addSource('provinces', { type: 'geojson', data: '/data/provinces.geojson' });
      map.addSource('facilities', { type: 'geojson', data: mode === 'system' ? '/data/facilities.geojson' : EMPTY as never, promoteId: 'id' });
      map.addSource('settlements', { type: 'geojson', data: mode === 'access' ? '/data/settlements.geojson' : EMPTY as never });
      map.addSource('isochrones', { type: 'geojson', data: EMPTY as never });
      map.addSource('route', { type: 'geojson', data: EMPTY as never });
      routeSourceRef.current = map.getSource('route') as GeoJSONSource;

      map.addLayer({ id: 'province-fill', type: 'fill', source: 'provinces', paint: { 'fill-color': '#436497', 'fill-opacity': 0.035 } });
      map.addLayer({ id: 'iso-band-60', type: 'fill', source: 'isochrones', filter: ['==', ['get', 'range_seconds'], 3600], paint: { 'fill-color': '#0000ff', 'fill-opacity': 0.34 } });
      map.addLayer({ id: 'iso-band-30', type: 'fill', source: 'isochrones', filter: ['==', ['get', 'range_seconds'], 1800], paint: { 'fill-color': '#00ff00', 'fill-opacity': 0.34 } });
      map.addLayer({ id: 'iso-band-15', type: 'fill', source: 'isochrones', filter: ['==', ['get', 'range_seconds'], 900], paint: { 'fill-color': '#ffff00', 'fill-opacity': 0.38 } });
      map.addLayer({ id: 'iso-band-5', type: 'fill', source: 'isochrones', filter: ['==', ['get', 'range_seconds'], 300], paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.42 } });
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
          if (bounds) map.fitBounds(bounds, { padding: 70, maxZoom: 7.2, duration: motionDuration(850) });
        }
      });
      map.on('mouseenter', 'province-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'province-fill', () => { map.getCanvas().style.cursor = ''; });
      map.on('click', 'facility-points', (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['facility-points'] })[0];
        const properties = feature?.properties;
        if (!properties) return;
        const popup = document.createElement('div');
        popup.className = 'facility-popup';
        const title = document.createElement('strong');
        title.textContent = String(properties.name ?? 'Establecimiento');
        popup.append(title);
        for (const [label, value] of [['Tipo', properties.category], ['Localidad', properties.locality], ['Coordenadas', properties.coordinate_status === 'recovered_from_healthsites' ? 'posición recuperada de Healthsites' : 'coordenadas informadas']]) {
          const row = document.createElement('span');
          row.textContent = `${label}: ${String(value ?? '—')}`;
          popup.append(row);
        }
        new Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px' }).setLngLat(event.lngLat).setDOMContent(popup).addTo(map);
      });
      map.on('mouseenter', 'facility-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'facility-points', () => { map.getCanvas().style.cursor = ''; });
      map.fitBounds([[-74, -56], [-52, -20]], { padding: { top: 30, bottom: 30, left: 30, right: 30 }, duration: 0 });
      setLoaded(true);
    });
    return () => {
      routeSourceRef.current = null;
      map.remove();
      window.removeEventListener('radio-map-command', command);
      mapRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!loaded || mode !== 'access') return;
    let cancelled = false;
    const source = mapRef.current?.getSource('isochrones') as GeoJSONSource | undefined;
    source?.setData(EMPTY as never);
    setAccessStatus({ kind: 'loading', message: provinceId ? 'Cargando isócronas de la provincia...' : 'Cargando vista nacional...' });
    const load = async () => {
      try {
        const response = await fetch('/data/access/manifest.json');
        if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) throw new Error('No se pudieron cargar los datos de acceso. Recargá la página; si sigue fallando, probá más tarde.');
        const manifest = await response.json() as {
          overview?: string;
          provinces: Record<string, string[]>;
          province_categories?: Record<string, Record<string, string[]>>;
        };
        let files: string[];
        if (provinceId) {
          const categoryFiles = manifest.province_categories?.[provinceId];
          files = categories.length && categoryFiles
            ? [...new Set(categories.flatMap((category) => categoryFiles[category] ?? []))]
            : manifest.provinces[provinceId] ?? [];
        } else {
          if (!manifest.overview) throw new Error('La vista nacional de acceso no está disponible. Probá más tarde.');
          files = [manifest.overview];
        }
        if (files.length === 0) {
          if (!cancelled) setAccessStatus({ kind: 'error', message: 'No hay áreas de acceso para esta selección. Elegí otro tipo de establecimiento o provincia.' });
          return;
        }
        const features: FeatureCollection['features'] = [];
        for (const file of files) {
          const collection = await accessChunk(`/data/access/${file}`);
          features.push(...collection.features);
        }
        if (cancelled) return;
        (mapRef.current?.getSource('isochrones') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features } as never);
        setAccessStatus(null);
      } catch (error) {
        if (!cancelled) setAccessStatus({ kind: 'error', message: 'No se pudieron cargar las áreas de acceso. Recargá la página; si sigue fallando, probá más tarde.' });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [loaded, mode, provinceId, categories]);

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
    for (const id of ['iso-band-5', 'iso-band-15', 'iso-band-30', 'iso-band-60', 'settlement-points']) {
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
      for (const minutes of [5, 15, 30, 60]) {
        const id = `iso-band-${minutes}`;
        map.setFilter(id, ['all', ...isoFilter, ['==', ['get', 'range_seconds'], minutes * 60]] as never);
        map.setLayoutProperty(id, 'visibility', threshold >= minutes ? 'visible' : 'none');
      }
    }
  }, [loaded, mode, provinceId, categories, threshold]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    if (!provinceId) {
      map.fitBounds([[-74, -56], [-52, -20]], { padding: 38, maxZoom: 3.4, duration: motionDuration(650) });
      return;
    }
    fetch('/data/provinces.geojson').then((response) => response.ok ? response.json() : null).then((data) => {
      const feature = data?.features?.find((item: { properties?: { province_id?: string } }) => String(item.properties?.province_id) === provinceId);
      const bounds = feature && boundsOf(feature.geometry);
      if (bounds) map.fitBounds(bounds, { padding: 70, maxZoom: 7.2, duration: motionDuration(650) });
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
    if (map && bounds) map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: motionDuration(800) });
  }, [loaded, route]);

  return <>
    <div ref={container} className="map-canvas" aria-label="Mapa interactivo de establecimientos y accesibilidad sanitaria en Argentina" />
    {mode === 'access' && accessStatus && <div className={`map-data-status ${accessStatus.kind}`} role="status">{accessStatus.message}</div>}
  </>;
}
