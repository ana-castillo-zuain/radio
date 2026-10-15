import { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from './MapCanvas';
import { coveredSettlementCount, type SettlementCoverage } from './access';
import type { Category, FacilityCollection, Metrics, ProvinceMetrics, RouteResult } from './types';

type Section = 'system' | 'access' | 'route';
type DrawerKind = 'facilities' | 'doctors' | 'nurses' | null;
type ComparisonOrder = 'doctors' | 'reachability';
type GenerationReport = { omitted_facility_count: number };
type AccessManifest = { complete: boolean; completed_jobs: number; total_jobs: number };

const SECTIONS: { id: Section; number: string; name: string }[] = [
  { id: 'system', number: '01', name: 'Radiografía' },
  { id: 'access', number: '02', name: 'Eco Doppler' },
  { id: 'route', number: '03', name: 'Derivación' },
];
const TOUR_STEPS = [
  { label: '01 · DISTRIBUCIÓN', title: 'Leé el mapa del sistema', body: 'Cada punto es un establecimiento REFES con coordenadas válidas o recuperadas desde Healthsites. El resplandor ayuda a ver concentraciones; acercate para distinguir establecimientos individuales.' },
  { label: '02 · RECURSOS', title: 'Abrí los indicadores', body: 'Las tarjetas de médicos y enfermería muestran profesionales activos hasta los 64 años inclusive. Al abrirlas vas a encontrar origen, habilitados de todas las edades y, para enfermería, formación.' },
  { label: '03 · ACCESO', title: 'Compará tiempos de viaje', body: 'Elegí provincia, tipo de establecimiento y tiempo máximo. El porcentaje cuenta asentamientos, no personas.' },
  { label: '04 · TU RECORRIDO', title: 'Buscá un establecimiento cercano', body: 'Ingresá una dirección y elegí qué tipo de establecimiento necesitás. Comparamos rutas en auto; los tiempos son estimados y pueden diferir del tránsito real.' },
];

const fmt = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('es-AR').format(n);
const fmtRate = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function fetchOptionalJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.toLowerCase().includes('json')) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function sumOrigins(records: Record<string, { origen_activos: Record<string, number> }>): Record<string, number> {
  return Object.values(records).reduce((acc, item) => {
    for (const [key, value] of Object.entries(item.origen_activos)) acc[key] = (acc[key] ?? 0) + value;
    return acc;
  }, {} as Record<string, number>);
}

function Icon({ name }: { name: 'pin' | 'people' | 'arrow' | 'close' | 'search' | 'filter' }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  if (name === 'pin') return <svg {...common}><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.4"/></svg>;
  if (name === 'people') return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (name === 'arrow') return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
  if (name === 'close') return <svg {...common}><path d="m18 6-12 12M6 6l12 12"/></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  return <svg {...common}><path d="M4 7h16M7 12h10m-7 5h4"/><circle cx="6" cy="7" r="1"/><circle cx="17" cy="12" r="1"/></svg>;
}

function ViewerHud() {
  const [zoom, setZoom] = useState('3.3');
  useEffect(() => { const update = (event: Event) => setZoom((event as CustomEvent<number>).detail.toFixed(1)); window.addEventListener('radio-map-zoom', update); return () => window.removeEventListener('radio-map-zoom', update); }, []);
  return <div className="viewer-hud"><span>ZOOM: {zoom}</span><span>ROT: 0</span><span>L: 128 W: 256</span></div>;
}

function FacilityDrawer({
  kind, onClose, categories, selected, onToggle, onClear, province, metrics,
}: {
  kind: DrawerKind; onClose: () => void; categories: Category[]; selected: string[];
  onToggle: (category: string) => void; onClear: () => void; province: ProvinceMetrics | null; metrics: Metrics;
}) {
  const [query, setQuery] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButtonRef.current?.focus(); }, []);
  if (!kind) return null;
  const title = kind === 'facilities' ? 'Tipologías REFES' : kind === 'doctors' ? 'Profesionales de medicina' : 'Profesionales de enfermería';
  const origins = kind === 'doctors'
    ? (province?.doctors.origen_activos ?? sumOrigins(metrics.professionals.doctors))
    : (province?.nurses.origen_activos ?? sumOrigins(metrics.professionals.nurses));
  const active = kind === 'doctors'
    ? (province?.doctors.activos ?? metrics.professionals.doctors_active)
    : (province?.nurses.activos ?? metrics.professionals.nurses_active);
  const authorized = kind === 'doctors'
    ? (province?.doctors.habilitados ?? Object.values(metrics.professionals.doctors).reduce((s, v) => s + v.habilitados, 0))
    : (province?.nurses.habilitados ?? Object.values(metrics.professionals.nurses).reduce((s, v) => s + v.habilitados, 0));
  const specialty = kind === 'nurses'
    ? (province?.nurse_specialties_active ?? Object.values(metrics.professionals.nurse_specialties_active).reduce((acc, row) => {
      Object.entries(row).forEach(([key, value]) => { acc[key] = (acc[key] ?? 0) + value; });
      return acc;
    }, {} as Record<string, number>))
    : {};
  const filtered = categories.filter((item) => item.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  return <>
    <button className="drawer-scrim" onClick={onClose} aria-label="Cerrar detalle" />
    <aside className="drawer" aria-label={title}>
      <div className="drawer-head">
        <div><span className="eyebrow">DESGLOSE {province ? `· ${province.name}` : '· ARGENTINA'}</span><h3>{title}</h3></div>
        <button ref={closeButtonRef} className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
      </div>
      {kind === 'facilities' ? <>
        <p className="drawer-copy">Elegí uno o más tipos de establecimiento. Los demás puntos se apagan en el mapa.</p>
        <label className="search-field category-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre" /></label>
        <div className="filter-actions"><span>{selected.length ? `${selected.length} seleccionados` : 'Todos los tipos de establecimiento'}</span><button onClick={onClear} disabled={!selected.length}>Limpiar</button></div>
        <div className="category-list">{filtered.map((item) => <label className="category-row" key={item.name}>
          <input type="checkbox" checked={selected.includes(item.name)} onChange={() => onToggle(item.name)} />
          <span className="category-name">{item.name}</span><span className="category-count">{fmt(item.count)}</span>
        </label>)}</div>
      </> : <>
        <div className="drawer-total"><strong>{fmt(active)}</strong><span>activos hasta los 64 años</span></div>
        <div className="drawer-list">
          <div><span>De origen nacional</span><strong>{fmt(origins.Argentina ?? 0)}</strong></div>
          <div><span>De origen extranjero</span><strong>{fmt(origins.Extranjero ?? 0)}</strong></div>
          <div><span>Origen desconocido</span><strong>{fmt(origins.Desconocido ?? 0)}</strong></div>
          <div><span>Habilitados de todas las edades</span><strong>{fmt(authorized)}</strong></div>
        </div>
        {kind === 'nurses' && <><h4>Formación profesional</h4><div className="drawer-list">{Object.entries(specialty).map(([name, count]) => <div key={name}><span>{name}</span><strong>{fmt(count)}</strong></div>)}</div></>}
        <p className="method-note">REFePS publica grupos quinquenales de edad; “activos” se calcula sumando los grupos hasta 60–64 inclusive.</p>
      </>}
    </aside>
  </>;
}

function App() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [facilities, setFacilities] = useState<FacilityCollection | null>(null);
  const [settlementCoverage, setSettlementCoverage] = useState<SettlementCoverage[] | null>(null);
  const [generationReport, setGenerationReport] = useState<GenerationReport | null>(null);
  const [accessManifest, setAccessManifest] = useState<AccessManifest | null>(null);
  const [dataError, setDataError] = useState('');
  const [section, setSection] = useState<Section>('system');
  const [provinceId, setProvinceId] = useState<string | null>(null);
  const [provinceName, setProvinceName] = useState('Argentina');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [threshold, setThreshold] = useState(60);
  const [address, setAddress] = useState('');
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeMessage, setRouteMessage] = useState('');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [viewerTools, setViewerTools] = useState<string[]>([]);
  const [comparisonOrder, setComparisonOrder] = useState<ComparisonOrder>('doctors');

  const hashState = useMemo(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return {
      provinceId: params.get('province') || null,
      threshold: [5, 15, 30, 60].includes(Number(params.get('threshold'))) ? Number(params.get('threshold')) : 60,
      categories: params.get('types') ? params.get('types')!.split('|').filter(Boolean) : [],
    };
  }, []);

  useEffect(() => {
    setProvinceId(hashState.provinceId);
    setThreshold(hashState.threshold);
    setSelectedCategories(hashState.categories);
  }, [hashState]);

  useEffect(() => {
    Promise.all([
      fetch('/data/metrics.json').then((r) => { if (!r.ok) throw new Error('No pudimos cargar los datos. Recargá la página; si sigue fallando, probá más tarde.'); return r.json() as Promise<Metrics>; }),
      fetch('/data/facilities.geojson').then((r) => { if (!r.ok) throw new Error('No se encontró el mapa de establecimientos.'); return r.json() as Promise<FacilityCollection>; }),
      fetchOptionalJson<SettlementCoverage[]>('/data/access/settlement-coverage.json'),
      fetchOptionalJson<AccessManifest>('/data/access/manifest.json'),
      fetchOptionalJson<GenerationReport>('/data/access/generation-report.json'),
    ]).then(([m, f, coverage, manifest, report]) => { setMetrics(m); setFacilities(f); setSettlementCoverage(coverage); setAccessManifest(manifest); setGenerationReport(report); })
      .catch(() => setDataError('No pudimos cargar los datos. Recargá la página; si sigue fallando, probá más tarde.'));
  }, []);

  const categories = metrics?.facility_categories ?? [];
  const selectedProvince = provinceId && metrics ? metrics.provinces[provinceId] ?? null : null;
  const access = useMemo(() => coveredSettlementCount(settlementCoverage, provinceId, selectedCategories, threshold), [settlementCoverage, provinceId, selectedCategories, threshold]);
  const partialAccess = accessManifest !== null && !accessManifest.complete;
  const nationalPopulation = metrics ? Object.values(metrics.provinces).reduce((sum, item) => sum + item.population_2022, 0) : 0;
  const doctorsRate = selectedProvince?.doctors_per_1000 ?? metrics?.professionals.doctors_per_1000;
  const nursesRate = selectedProvince?.nurses_per_1000 ?? metrics?.professionals.nurses_per_1000;
  const comparisonRows = useMemo(() => Object.values(metrics?.provinces ?? {}).map((province) => {
    const coverage = coveredSettlementCount(settlementCoverage, province.province_id, selectedCategories, threshold);
    const reachability = coverage ? coverage.covered / Math.max(coverage.total, 1) * 100 : null;
    return { province, uncovered: reachability == null ? null : 100 - reachability, reachability };
  }).sort((a, b) => comparisonOrder === 'doctors'
    ? b.province.doctors_per_1000 - a.province.doctors_per_1000
    : (b.reachability ?? -1) - (a.reachability ?? -1)), [metrics, settlementCoverage, selectedCategories, threshold, comparisonOrder]);

  function toggleCategory(category: string) {
    setSelectedCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  function chooseProvince(id: string, name: string) {
    setProvinceId(id);
    setProvinceName(name);
    if (section !== 'route') setSection('access');
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (provinceId) params.set('province', provinceId);
    params.set('threshold', String(threshold));
    if (selectedCategories.length) params.set('types', selectedCategories.join('|'));
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${params.toString()}`);
  }, [provinceId, threshold, selectedCategories]);

  function navigate(next: Section) {
    setSection(next);
  }

  function moveView(direction: -1 | 1) {
    const current = SECTIONS.findIndex((item) => item.id === section);
    navigate(SECTIONS[(current + direction + SECTIONS.length) % SECTIONS.length].id);
  }

  function runViewerCommand(command: 'zoom-in' | 'zoom-out' | 'reset' | 'pan' | 'scale') {
    window.dispatchEvent(new CustomEvent('radio-map-command', { detail: command }));
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawer(null);
        setTourStep(null);
        return;
      }
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
      if (event.altKey && event.key === 'ArrowRight') moveView(1);
      if (event.altKey && event.key === 'ArrowLeft') moveView(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [section]);

  async function searchNearest(event: React.FormEvent) {
    event.preventDefault();
    setRouteMessage(''); setRoute(null);
    if (!facilities?.features.length) { setRouteMessage('Los establecimientos todavía no están disponibles.'); return; }
    if (!address.trim()) { setRouteMessage('Ingresá una dirección para empezar.'); return; }
    setLoadingRoute(true);
    try {
      const geocodeResponse = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'geocode', query: address.trim() }) });
      const geocodeData = await geocodeResponse.json();
      if (!geocodeResponse.ok) throw new Error(geocodeData.error ?? 'No se pudo ubicar esa dirección.');
      const origin = geocodeData.coordinates as [number, number];
      const candidates = facilities.features
        .filter((feature) => !selectedCategories.length || selectedCategories.includes(feature.properties.category))
        .map((feature) => {
          const [lon, lat] = feature.geometry.coordinates;
          const rad = (value: number) => value * Math.PI / 180;
          const dLat = rad(lat - origin[1]); const dLon = rad(lon - origin[0]);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(origin[1])) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
          return { feature, distance: 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) };
        }).sort((a, b) => a.distance - b.distance).slice(0, 8).map(({ feature }) => ({
          id: feature.properties.id, name: feature.properties.name, locality: feature.properties.locality,
          province: feature.properties.province, category: feature.properties.category,
          coordinates: feature.geometry.coordinates,
        }));
      if (!candidates.length) throw new Error('No hay establecimientos geolocalizados para ese tipo.');
      const routeResponse = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'route', origin, candidates }) });
      const routeData = await routeResponse.json();
      if (!routeResponse.ok) throw new Error(routeData.error ?? 'No se pudo calcular la ruta.');
      setRoute({ ...routeData, address: geocodeData.label } as RouteResult);
      setRouteMessage('');
    } catch (error) {
      setRouteMessage(error instanceof Error ? error.message : 'Ocurrió un error al calcular el recorrido.');
    } finally { setLoadingRoute(false); }
  }

  return <div className="app-shell">
    <header className="site-header">
      <div className="app-name">RADIO SALUD</div>
      <div className="study-meta"><span>PACIENTE: SISTEMA DE SALUD</span><span>ID: 48-2607013747-1</span><span>EXAMEN: DIAGNÓSTICO DE COBERTURA</span><span>FECHA: 14/10/2026</span><span>HOSPITAL: ARGENTINA</span></div>
      <div className="header-actions"><button className="guide-button" onClick={() => setTourStep(0)}>GUÍA <span>↗</span></button><a className="source-link" href="#fuentes">FUENTES <span>↗</span></a></div>
    </header>

    {dataError && <div className="data-error" role="alert"><strong>Falta preparar los datos.</strong> {dataError}</div>}

    <div className="viewer-shell">
      <aside className="clinical-sidebar">
        <section className="sidebar-block sidebar-diagnostics"><div className="sidebar-title">DIAGNÓSTICOS <span>−</span></div><strong>{provinceId ? provinceName.toUpperCase() : 'VISTA NACIONAL'}</strong><span>{section === 'access' ? `${threshold} MIN · ${selectedCategories.length ? `${selectedCategories.length} TIPOLOGÍAS` : 'TODAS LAS TIPOLOGÍAS'}` : section === 'route' ? (route ? 'RUTA CALCULADA' : 'ESPERANDO UBICACIÓN') : 'DISTRIBUCIÓN REFES'}</span>{partialAccess && section === 'access' && <b className="warning-diagnostic">CÁLCULO PARCIAL</b>}</section>
        <section className="sidebar-block sidebar-thumbs"><div className="sidebar-title">MINIATURAS</div>{SECTIONS.map((item, index) => <button key={item.id} className={section === item.id ? 'selected' : ''} onClick={() => navigate(item.id)}><i className={`thumbnail-preview thumb-${item.id}`} /><span>0{index + 1} · {item.name}</span></button>)}</section>
        <div className="sidebar-foot"><span>VISORES DE DATOS</span><span>ARGENTINA · 2026</span></div>
      </aside>
      <div className="viewer-workspace">
    <div className="viewer-nav"><button onClick={() => moveView(-1)}>[◀ ANT]</button><strong>VISTA: {SECTIONS.findIndex((item) => item.id === section) + 1} / 3 <span>[{SECTIONS.find((item) => item.id === section)?.name.toUpperCase()}]</span></strong><button onClick={() => moveView(1)}>[SIG ▶]</button></div>
    <div className="viewer-toolbar" role="toolbar" aria-label="Herramientas del visor"><button aria-pressed={viewerTools.includes('contrast')} onClick={() => setViewerTools((tools) => tools.includes('contrast') ? tools.filter((tool) => tool !== 'contrast') : [...tools, 'contrast'])}>◐ CONTRASTE</button><button aria-pressed={viewerTools.includes('crosshair')} onClick={() => setViewerTools((tools) => tools.includes('crosshair') ? tools.filter((tool) => tool !== 'crosshair') : [...tools, 'crosshair'])}>＋ CRUZ</button><button onClick={() => runViewerCommand('reset')}>↺ REINICIAR</button></div>

    <main className={`viewer-main ${viewerTools.map((tool) => `tool-${tool}`).join(' ')}`}>
      {section === 'system' && <section id="system" className="story-section story-system active-view">
        <div className="section-heading">
          <div><span className="eyebrow"><span className="status-dot" /> INFORME INTERACTIVO · ARGENTINA</span>
            <h1>Radiografía de nuestro<br /><em>sistema de salud</em></h1>
            <p>Más de 8 de cada 10 asentamientos tienen un establecimiento a menos de una hora en auto. Solo 3 de cada 10 tienen uno con guardia permanente. Contamos asentamientos, no personas.</p>
          </div>
        </div>
        <div className="story-grid system-grid">
          <div className="map-frame">
            <div className="map-topline"><span><i className="map-live-dot" /> DISTRIBUCIÓN DE EFECTORES</span><span>REFES · {metrics?.source_years.refes ?? '—'}</span></div>
            <MapCanvas active mode="system" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} />
            <ViewerHud />
            <div className="map-legend"><span className="legend-glow" /> <span>Efectores REFES geolocalizados</span><span className="legend-separator" /><span className="boundary-swatch" /> Provincias</div>
            <div className="map-scale">{selectedCategories.length ? `${selectedCategories.length} tipos de establecimiento · ` : ''}{provinceName}</div>
          </div>
          <aside className="metrics-column">
            <div className="metric-card metric-facilities" role="button" tabIndex={0} onClick={() => setDrawer('facilities')} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setDrawer('facilities'))}>
              <div className="metric-card-label"><span className="metric-icon"><Icon name="pin" /></span><span>ESTABLECIMIENTOS REFES</span><span className="metric-open">↗</span></div>
              <strong className="metric-number">{fmt(metrics?.facility_counts.total)}</strong>
              <span className="metric-sub">establecimientos registrados · ver tipos</span>
              <div className="coord-track"><span style={{ width: `${metrics ? metrics.facility_counts.mapped / metrics.facility_counts.total * 100 : 0}%` }} /></div>
              <div className="coord-breakdown"><span><i className="dot-mint" /> {fmt(metrics?.facility_counts.valid_argentina_bounds)} válidas</span><span><i className="dot-blue" /> {fmt(metrics?.facility_counts.recovered_from_healthsites)} Healthsites</span><span><i className="dot-empty" /> {fmt(metrics?.facility_counts.missing_or_non_numeric)} faltan</span></div>
            </div>
            <div className="people-cards">
              <button className="metric-card person-card" onClick={() => setDrawer('doctors')}>
                <div className="metric-card-label"><span className="metric-icon"><Icon name="people" /></span><span>MÉDICOS ACTIVOS</span><span className="metric-open">↗</span></div>
                <strong className="metric-number">{fmt(metrics?.professionals.doctors_active)}</strong>
                <span className="metric-sub">hasta 64 años · REFEPS 2023</span>
              </button>
              <button className="metric-card person-card" onClick={() => setDrawer('nurses')}>
                <div className="metric-card-label"><span className="metric-icon"><Icon name="people" /></span><span>ENFERMERÍA ACTIVA</span><span className="metric-open">↗</span></div>
                <strong className="metric-number">{fmt(metrics?.professionals.nurses_active)}</strong>
                <span className="metric-sub">auxiliares, enfermeros y licenciados</span>
              </button>
            </div>
            <div className="ratio-card"><div><span className="eyebrow">ENFERMERÍA POR CADA MÉDICO</span><strong>{fmtRate(metrics?.professionals.nurses_per_doctor)} <small>: 1</small></strong></div><div className="ratio-target"><span>REFERENCIA GLOBAL</span><b>2 : 1</b></div><div className="ratio-bar"><span style={{ width: `${Math.min((metrics?.professionals.nurses_per_doctor ?? 0) / 2 * 100, 100)}%` }} /></div><p>La OMS reportó una relación mundial de 2 enfermeros y parteras por médico en 2013 (<a href="https://cdn.who.int/media/docs/default-source/searo/india/publications/health-workforce-in-india-where-to-invest--how-much-and-why.pdf" target="_blank" rel="noreferrer">OMS, Health workforce in India</a>).</p></div>
          </aside>
        </div>
        <div className="section-footnote"><span>Datos de establecimientos REFES · profesionales REFEPS · Hacé clic en las tarjetas para ver el detalle</span></div>
      </section>

      }

      {section === 'access' && <section id="access" className="story-section story-access active-view">
        <div className="section-heading section-heading-compact">
          <div><span className="eyebrow"><span className="status-dot status-green" /> ACCESO TERRITORIAL · EN AUTO</span>
            <h2>No siempre está <em>igual de cerca.</em></h2>
            <p className="section-deck">La radiografía muestra dónde están los establecimientos. El eco Doppler muestra cuánto tardás en llegar.</p>
          </div>
          <div className="province-select-wrap"><label htmlFor="province-select">TERRITORIO</label><select id="province-select" value={provinceId ?? ''} onChange={(e) => { const p = metrics?.provinces[e.target.value]; setProvinceId(e.target.value || null); setProvinceName(p?.name ?? 'Argentina'); }}><option value="">Argentina · nacional</option>{Object.values(metrics?.provinces ?? {}).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((province) => <option key={province.province_id} value={province.province_id}>{province.name}</option>)}</select></div>
        </div>
        <div className="story-grid access-grid">
          <div className="map-frame access-map-frame">
            <div className="map-topline"><span><i className="map-live-dot map-live-green" /> ECO DOPPLER · ACCESO TERRITORIAL</span><span>{provinceName.toUpperCase()}</span></div>
            <MapCanvas active mode="access" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} />
            <ViewerHud />
            {!!generationReport?.omitted_facility_count && <div className="isochrone-warning" role="status">No se pudieron calcular isócronas para {fmt(generationReport.omitted_facility_count)} establecimientos. <a href="/data/access/generation-report.json" target="_blank" rel="noreferrer">Ver reporte</a></div>}
            <div className="doppler-scale" aria-label="Escala de minutos de viaje inspirada en Doppler"><span>5 min</span><span>15 min</span><span>30 min</span><span>60 min</span><i /></div>
            {partialAccess && <div className="isochrone-warning isochrone-partial" role="status">Vista parcial: {fmt(accessManifest?.completed_jobs)} de {fmt(accessManifest?.total_jobs)} lotes procesados. Las áreas y coberturas pueden aumentar cuando termine el cálculo.</div>}
            {!accessManifest && <div className="map-empty-state"><span className="empty-icon">⌁</span><strong>Datos de acceso no disponibles</strong><span>La capa de acceso todavía no está disponible. Probá más tarde.</span></div>}
            <div className="map-scale">Elegí una provincia en el mapa para enfocarla.</div>
          </div>
          <aside className="metrics-column access-metrics">
            <div className="access-filter-row"><label htmlFor="threshold-select">UMBRAL DE VIAJE</label><select id="threshold-select" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}><option value="60">60 minutos</option><option value="30">30 minutos</option><option value="15">15 minutos</option><option value="5">5 minutos</option></select></div>
            <div className="access-presets"><span>TIPO DE ESTABLECIMIENTO</span><button onClick={() => setSelectedCategories([])}>Cualquier establecimiento</button><button onClick={() => setSelectedCategories(categories.filter((item) => item.name === 'Con guardia permanente').map((item) => item.name))}>Con guardia permanente</button><button onClick={() => setSelectedCategories(categories.filter((item) => item.name === 'Alto riesgo con terapia intensiva').map((item) => item.name))}>Alto riesgo con terapia intensiva</button></div>
            <div className="metric-card access-primary"><span className="eyebrow">{partialAccess ? `ALCANZADOS EN HASTA ${threshold} MIN (MÍNIMO)` : `ASENTAMIENTOS SIN UN ESTABLECIMIENTO A MENOS DE ${threshold} MIN EN AUTO`}</span><strong className="metric-number">{access ? `${fmt(Math.round((partialAccess ? access.covered : access.total - access.covered) / Math.max(access.total, 1) * 100))}%` : '—'}</strong><span className="metric-sub">{access ? partialAccess ? `${fmt(access.covered)} de ${fmt(access.total)} alcanzados. El cálculo sigue en curso: el valor real puede ser mayor.` : `${fmt(access.total - access.covered)} de ${fmt(access.total)} asentamientos no tienen ningún establecimiento${selectedCategories.length ? ' del tipo elegido' : ''} a menos de ${threshold} min en auto.` : 'El cálculo de acceso todavía no está disponible.'}</span><div className="access-denominator">Contamos lugares, no personas: un paraje pesa igual que una ciudad, y 7 de cada 10 asentamientos del país son parajes rurales.</div><span className="method-note" title="Un asentamiento (BAHRA) cuenta como cubierto si al menos un establecimiento del tipo elegido llega a él en auto dentro del tiempo indicado.">¿Cómo se calcula?</span></div>
            <button className="metric-card rate-card" onClick={() => setDrawer('doctors')}><div className="rate-title"><span>MÉDICOS / 1.000 HAB.</span><span className="metric-open">↗</span></div><strong>{fmtRate(doctorsRate)}</strong><span>población Censo 2022 · clic para desglose</span></button>
            <button className="metric-card rate-card" onClick={() => setDrawer('nurses')}><div className="rate-title"><span>ENFERMERÍA / 1.000 HAB.</span><span className="metric-open">↗</span></div><strong>{fmtRate(nursesRate)}</strong><span>población Censo 2022 · clic para desglose</span></button>
            <div className="ratio-inline"><div><span>ENFERMERÍA : MEDICINA</span><b>{fmtRate(selectedProvince?.nurses_per_doctor ?? metrics?.professionals.nurses_per_doctor)} : 1</b></div><span className="data-period">REFePS 2023 / Censo {metrics?.source_years.population ?? 2022} · población: {fmt(selectedProvince?.population_2022 ?? nationalPopulation)}</span></div>
            <div className="clinical-panel"><span className="eyebrow">¿POR QUÉ IMPORTA EL TIEMPO?</span><article><b>5 MIN · ASFIXIA</b><p>Una obstrucción grave de la respiración exige respuesta inmediata. La banda muestra cercanía estimada a un establecimiento, no un plazo de daño.</p></article><article><b>15 MIN · PARO CARDÍACO</b><p>Iniciar RCP y usar un desfibrilador cuanto antes es fundamental. La banda mide proximidad; no incluye despacho ni ambulancia.</p></article><article><b>30 MIN · ACV SOSPECHADO</b><p>Llegar pronto facilita la evaluación neurológica y las imágenes que orientan el tratamiento. La ventana terapéutica se valora caso por caso.</p></article><article><b>60 MIN · TRAUMA GRAVE</b><p>La rapidez de la evaluación y del control del sangrado puede ser decisiva. La “hora dorada” es una referencia, no un límite clínico universal.</p></article><small>Los umbrales son referencias de acceso en auto hasta establecimientos REFES; no predicen resultados individuales ni describen el tiempo total de una emergencia.</small><div className="clinical-sources"><a href="https://www.facs.org/quality-programs/trauma/systems/trauma-series/part-iv/" target="_blank" rel="noreferrer">ACS · TRAUMA</a><a href="https://professional.heart.org/en/science-news/~/link.aspx?_id=BAB8B4E3D2C7472F942AA69EEE8D7B79&_z=z" target="_blank" rel="noreferrer">AHA · ACV</a><a href="https://www.heart.org/en/health-topics/cardiac-arrest/emergency-treatment-of-cardiac-arrest" target="_blank" rel="noreferrer">AHA · RCP/AED</a></div></div>
            <div className="access-method"><span className="method-pulse" />{selectedCategories.length ? `${selectedCategories.length} tipos de establecimiento seleccionados` : 'Todos los tipos de establecimiento REFES'}<button onClick={() => setDrawer('facilities')}>Cambiar <Icon name="arrow" /></button></div>
          </aside>
        </div>
        <section className="comparison-panel" aria-labelledby="comparison-title">
          <div className="comparison-heading"><div><span className="eyebrow">LECTURA COMPARADA · 24 PROVINCIAS</span><h2 id="comparison-title">Recursos y distancia, en la misma escala territorial</h2></div><p>Elegí el orden. Cada fila conserva las dos medidas: médicos cada 1.000 habitantes y asentamientos alcanzados dentro del umbral elegido.</p></div>
          <div className="comparison-controls" role="group" aria-label="Ordenar provincias"><span>ORDENAR POR</span><button className={comparisonOrder === 'doctors' ? 'selected' : ''} onClick={() => setComparisonOrder('doctors')}>Médicos / 1.000</button><button className={comparisonOrder === 'reachability' ? 'selected' : ''} onClick={() => setComparisonOrder('reachability')}>Alcanzados en {threshold} min</button></div>
          <div className="comparison-list">{comparisonRows.map(({ province, uncovered, reachability }) => <button key={province.province_id} className={`comparison-row ${province.province_id === provinceId ? 'selected' : ''}`} onClick={() => chooseProvince(province.province_id, province.name)}><span className="comparison-name">{province.name}</span><span className="comparison-track doctors-track"><i style={{ width: `${Math.min(province.doctors_per_1000 / 16 * 100, 100)}%` }} /><b>{fmtRate(province.doctors_per_1000)}</b></span><span className="comparison-track reachability-track"><i style={{ width: `${reachability == null ? 0 : reachability}%` }} /><b>{reachability == null ? '—' : `${Math.round(reachability)}%`}</b></span><span className="comparison-uncovered">{uncovered == null ? '—' : `${Math.round(uncovered)}% sin alcanzar`}</span></button>)}</div>
          <p className="comparison-note">CABA aparece como valor atípico (15,8 médicos cada 1.000): el denominador es su población residente del Censo 2022.</p>
        </section>
        <div className="section-footnote"><span>Porcentaje de asentamientos BAHRA, sin ponderar por población · tiempos de viaje estimados</span></div>
      </section>

      }

      {section === 'route' && <section id="route" className="story-section story-route active-view">
        <div className="section-heading section-heading-compact">
          <div><span className="eyebrow"><span className="status-dot status-green" /> UNA PREGUNTA PERSONAL</span>
            <h2>Tu <em>derivación</em></h2>
            <p className="section-deck">Escribí una dirección y trazamos el recorrido en auto hasta el establecimiento más cercano del tipo que elijas.</p>
          </div>
        </div>
        <div className="story-grid route-grid">
          <div className="map-frame route-map-frame"><div className="map-topline"><span><i className="map-live-dot map-live-green" /> RECORRIDO EN RED VIAL</span><span>OPENSTREETMAP · ROUTING</span></div><MapCanvas active mode="route" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} /><ViewerHud />
            {route && <div className="route-result-card"><div className="route-result-icon"><Icon name="pin" /></div><div className="route-result-copy"><span>ESTABLECIMIENTO MÁS CERCANO · {route.facility.category}</span><strong>{route.facility.name}</strong><small>{route.facility.locality}, {route.facility.province}</small></div><div className="route-result-time"><strong>{Math.max(1, Math.round(route.duration_seconds / 60))}<small> min</small></strong><span>{(route.distance_meters / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km</span></div></div>}
            {!route && <div className="route-map-note"><span>⌖</span>Tu recorrido aparece acá</div>}
          </div>
          <aside className="route-search-panel">
            <div className="route-number">01 <span>· TU PUNTO DE PARTIDA</span></div>
            <form onSubmit={searchNearest}>
              <label htmlFor="address">Ingresá una dirección en Argentina</label>
              <div className="address-input"><Icon name="search" /><input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ej. Av. Corrientes 1234, CABA" autoComplete="street-address" /></div>
              <label htmlFor="route-category">¿Qué tipo de establecimiento buscás?</label>
              <select id="route-category" value={selectedCategories.length === 1 ? selectedCategories[0] : ''} onChange={(e) => setSelectedCategories(e.target.value ? [e.target.value] : [])}><option value="">Cualquier establecimiento REFES</option>{categories.map((category) => <option key={category.name} value={category.name}>{category.name}</option>)}</select>
              <button className="route-submit" type="submit" disabled={loadingRoute}>{loadingRoute ? <><span className="spinner" /> Buscando recorrido…</> : <>Encontrar establecimiento <Icon name="arrow" /></>}</button>
            </form>
            {routeMessage && <div className="route-message" role="status">{routeMessage}</div>}
            <div className="route-steps"><div><span>1</span><p>Ubicamos tu dirección en el mapa.</p></div><div><span>2</span><p>Comparamos el tiempo en auto a los 8 establecimientos más cercanos en línea recta.</p></div><div><span>3</span><p>Mostramos la ruta en la red vial de OpenStreetMap.</p></div></div>
            <p className="privacy-note">La dirección se envía a OpenStreetMap y OpenRouteService para calcular el recorrido. No guardamos la búsqueda en esta aplicación.</p>
          </aside>
        </div>
        <div className="section-footnote"><span>Ruta y tiempo estimados; pueden diferir del tránsito y las condiciones reales</span></div>
      </section>
      }
    </main>
      </div>
    </div>

    <FacilityDrawer kind={drawer} onClose={() => setDrawer(null)} categories={categories} selected={selectedCategories} onToggle={toggleCategory} onClear={() => setSelectedCategories([])} province={selectedProvince} metrics={metrics ?? {
      source_years: { refes: 2026, professionals: 2023, population: 2022 }, definitions: {}, facility_counts: { valid_argentina_bounds: 0, recovered_from_healthsites: 0, missing_or_non_numeric: 0, total: 0, mapped: 0 }, facility_categories: [], professionals: { doctors_active: 0, nurses_active: 0, doctors: {}, nurses: {}, nurse_specialties_active: {}, doctors_per_1000: 0, nurses_per_1000: 0, nurses_per_doctor: 0 }, provinces: {}, settlement_count: 0, population_audit: { sum_of_provinces: 0, reported_country_total: null, difference: null },
    }} />

    {tourStep !== null && <div className="tour-scrim" role="presentation" onClick={() => setTourStep(null)}><section className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" onClick={(event) => event.stopPropagation()}>
      <button className="icon-button tour-close" onClick={() => setTourStep(null)} aria-label="Cerrar guía"><Icon name="close" /></button>
      <span className="eyebrow">RECORRIDO GUIADO · {TOUR_STEPS[tourStep].label}</span>
      <div className="tour-progress">{TOUR_STEPS.map((_, index) => <i key={index} className={index <= tourStep ? 'current' : ''} />)}</div>
      <h3 id="tour-title">{TOUR_STEPS[tourStep].title}</h3><p>{TOUR_STEPS[tourStep].body}</p>
      <div className="tour-controls"><button className="tour-back" disabled={tourStep === 0} onClick={() => setTourStep((step) => step === null ? null : Math.max(0, step - 1))}>← Anterior</button><button className="tour-next" onClick={() => tourStep === TOUR_STEPS.length - 1 ? setTourStep(null) : setTourStep(tourStep + 1)}>{tourStep === TOUR_STEPS.length - 1 ? 'Terminar' : 'Siguiente →'}</button></div>
    </section></div>}

    <footer id="fuentes" className="site-footer"><div className="footer-title"><span className="brand-mark"><span /><span /><span /></span><strong>Una radiografía abierta<br />del sistema de salud.</strong></div><div className="footer-sources"><span className="eyebrow">FUENTES Y MÉTODO</span><p>REFES · establecimientos asistenciales {metrics?.source_years.refes ?? 2026}. REFEPS · stock de profesionales al 31/12/2023. INDEC · población del Censo 2022 y marco geoestadístico. BAHRA · asentamientos humanos. OpenStreetMap · cartografía vial.</p><p>Profesionales activos: hasta 64 años inclusive. Los porcentajes de acceso cuentan asentamientos, no personas. Las isócronas son tiempos estimados de viaje en auto sobre la red vial y sirven para explorar accesibilidad; no representan tiempos de respuesta de emergencia.</p>{metrics?.population_audit.difference ? <p>Control del denominador: la suma de las 24 poblaciones provinciales difiere en {fmt(Math.abs(metrics.population_audit.difference))} personas del total nacional que figura en el archivo.</p> : null}</div><div className="footer-mark">CONTAR CON DATOS<br /><span>2026</span></div></footer>
  </div>;
}

export default App;
