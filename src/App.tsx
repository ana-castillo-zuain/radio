import { useEffect, useMemo, useState } from 'react';
import MapCanvas from './MapCanvas';
import { coveredSettlementCount, type SettlementCoverage } from './access';
import type { Category, FacilityCollection, Metrics, ProvinceMetrics, RouteResult } from './types';

type Section = 'system' | 'access' | 'route';
type DrawerKind = 'facilities' | 'doctors' | 'nurses' | null;
type GenerationReport = { omitted_facility_count: number };
type AccessManifest = { complete: boolean; completed_jobs: number; total_jobs: number };

const SECTIONS: { id: Section; number: string; name: string }[] = [
  { id: 'system', number: '01', name: 'Radiografía' },
  { id: 'access', number: '02', name: 'Ecocardiograma' },
  { id: 'route', number: '03', name: 'Análisis' },
];
const TOUR_STEPS = [
  { label: '01 · DISTRIBUCIÓN', title: 'Leé el mapa del sistema', body: 'Cada punto es un efector del REFES con coordenadas válidas o recuperadas desde Healthsites. El resplandor ayuda a ver concentraciones; acercate para distinguir establecimientos individuales.' },
  { label: '02 · RECURSOS', title: 'Abrí los indicadores', body: 'Las tarjetas de médicos y enfermería muestran profesionales activos hasta los 64 años inclusive. Al abrirlas vas a encontrar origen, habilitados de todas las edades y, para enfermería, formación.' },
  { label: '03 · ACCESO', title: 'Compará tiempos de viaje', body: 'Elegí provincia, tipología y umbral. El porcentaje cuenta asentamientos BAHRA, sin ponderarlos por población. La capa de isócronas se activa cuando se complete y valide el cálculo sobre la red vial.' },
  { label: '04 · TU RECORRIDO', title: 'Buscá un centro cercano', body: 'Ingresá una dirección y elegí qué tipo de efector necesitás. La aplicación geocodifica la búsqueda y compara rutas en auto; los tiempos son estimados y pueden diferir del tránsito real.' },
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
  return <div className="viewer-hud"><span>ZOOM: MAPA</span><span>ROT: 0</span><span>L: 128 W: 256</span></div>;
}

function FacilityDrawer({
  kind, onClose, categories, selected, onToggle, onClear, province, metrics,
}: {
  kind: DrawerKind; onClose: () => void; categories: Category[]; selected: string[];
  onToggle: (category: string) => void; onClear: () => void; province: ProvinceMetrics | null; metrics: Metrics;
}) {
  const [query, setQuery] = useState('');
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
        <button className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
      </div>
      {kind === 'facilities' ? <>
        <p className="drawer-copy">Seleccioná una o más tipologías. Los puntos restantes se apagan en el mapa.</p>
        <label className="search-field category-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre" /></label>
        <div className="filter-actions"><span>{selected.length ? `${selected.length} seleccionada${selected.length === 1 ? '' : 's'}` : 'Todas las tipologías'}</span><button onClick={onClear} disabled={!selected.length}>Limpiar</button></div>
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

  useEffect(() => {
    Promise.all([
      fetch('/data/metrics.json').then((r) => { if (!r.ok) throw new Error('No están los datos preparados. Ejecutá primero npm run prepare-data.'); return r.json() as Promise<Metrics>; }),
      fetch('/data/facilities.geojson').then((r) => { if (!r.ok) throw new Error('No se encontró el mapa de efectores.'); return r.json() as Promise<FacilityCollection>; }),
      fetchOptionalJson<SettlementCoverage[]>('/data/access/settlement-coverage.json'),
      fetchOptionalJson<AccessManifest>('/data/access/manifest.json'),
      fetchOptionalJson<GenerationReport>('/data/access/generation-report.json'),
    ]).then(([m, f, coverage, manifest, report]) => { setMetrics(m); setFacilities(f); setSettlementCoverage(coverage); setAccessManifest(manifest); setGenerationReport(report); })
      .catch((error: Error) => setDataError(error.message));
  }, []);

  const categories = metrics?.facility_categories ?? [];
  const selectedProvince = provinceId && metrics ? metrics.provinces[provinceId] ?? null : null;
  const access = useMemo(() => coveredSettlementCount(settlementCoverage, provinceId, selectedCategories, threshold), [settlementCoverage, provinceId, selectedCategories, threshold]);
  const partialAccess = accessManifest !== null && !accessManifest.complete;
  const nationalPopulation = metrics ? Object.values(metrics.provinces).reduce((sum, item) => sum + item.population_2022, 0) : 0;
  const doctorsRate = selectedProvince?.doctors_per_1000 ?? metrics?.professionals.doctors_per_1000;
  const nursesRate = selectedProvince?.nurses_per_1000 ?? metrics?.professionals.nurses_per_1000;

  function toggleCategory(category: string) {
    setSelectedCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  function chooseProvince(id: string, name: string) {
    setProvinceId(id);
    setProvinceName(name);
    if (section !== 'route') setSection('access');
  }

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
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
      if (event.key === 'ArrowRight') moveView(1);
      if (event.key === 'ArrowLeft') moveView(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [section]);

  async function searchNearest(event: React.FormEvent) {
    event.preventDefault();
    setRouteMessage(''); setRoute(null);
    if (!facilities?.features.length) { setRouteMessage('No está listo el conjunto de efectores.'); return; }
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
      if (!candidates.length) throw new Error('No hay efectores geolocalizados para esa tipología.');
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
      <div className="study-meta"><span>PACIENTE: SISTEMA DE SALUD</span><span>ID: 48-2607013747-1</span><span>EXAMEN: DIAGNÓSTICO DE COBERTURA</span><span>FECHA: 07/07/2026</span><span>HOSPITAL: ARGENTINA</span></div>
      <div className="header-actions"><button className="guide-button" onClick={() => setTourStep(0)}>GUÍA <span>↗</span></button><a className="source-link" href="#fuentes">FUENTES <span>↗</span></a></div>
    </header>

    {dataError && <div className="data-error" role="alert"><strong>Falta preparar los datos.</strong> {dataError}</div>}

    <div className="viewer-shell">
      <aside className="clinical-sidebar">
        <section className="sidebar-block"><div className="sidebar-title">STUDY DETAILS <span>−</span></div><dl><dt>ID</dt><dd>48-2607013747-1</dd><dt>EXAMEN</dt><dd>Diagnóstico de cobertura</dd><dt>FUENTES</dt><dd>REFES · REFEPS · INDEC</dd></dl></section>
        <section className="sidebar-block"><div className="sidebar-title">VISTAS <span>−</span></div><nav className="sidebar-views" aria-label="Vistas del visor">{SECTIONS.map((item, index) => <button key={item.id} className={section === item.id ? 'selected' : ''} onClick={() => navigate(item.id)}><span>{index + 1}.</span>{item.name}{item.id === 'system' ? ' (X-Ray)' : ''}</button>)}</nav></section>
        <section className="sidebar-block sidebar-diagnostics"><div className="sidebar-title">DIAGNÓSTICOS <span>−</span></div><strong>{provinceId ? provinceName.toUpperCase() : 'VISTA NACIONAL'}</strong><span>{section === 'access' ? `${threshold} MIN · ${selectedCategories.length ? `${selectedCategories.length} TIPOLOGÍAS` : 'TODAS LAS TIPOLOGÍAS'}` : section === 'route' ? (route ? 'RUTA CALCULADA' : 'ESPERANDO UBICACIÓN') : 'DISTRIBUCIÓN REFES'}</span>{partialAccess && section === 'access' && <b className="warning-diagnostic">CÁLCULO PARCIAL</b>}</section>
        <section className="sidebar-block sidebar-thumbs"><div className="sidebar-title">THUMBNAIL <span>−</span></div>{SECTIONS.map((item, index) => <button key={item.id} className={section === item.id ? 'selected' : ''} onClick={() => navigate(item.id)}><i className={`thumbnail-preview thumb-${item.id}`} /><span>0{index + 1} · {item.name}</span></button>)}</section>
        <div className="sidebar-foot"><span>VISORES DE DATOS</span><span>ARGENTINA · 2026</span></div>
      </aside>
      <div className="viewer-workspace">
    <div className="viewer-nav"><button onClick={() => moveView(-1)}>[◀ PREV]</button><strong>VISTA: {SECTIONS.findIndex((item) => item.id === section) + 1} / 3 <span>[{SECTIONS.find((item) => item.id === section)?.name.toUpperCase()}]</span></strong><button onClick={() => moveView(1)}>[SIG ▶]</button></div>
    <div className="viewer-toolbar" role="toolbar" aria-label="Herramientas del visor"><button onClick={() => runViewerCommand('zoom-in')}>＋ ZOOM</button><button onClick={() => runViewerCommand('zoom-out')}>－ ZOOM</button><button onClick={() => runViewerCommand('pan')}>✥ PAN</button><button aria-pressed={viewerTools.includes('contrast')} onClick={() => setViewerTools((tools) => tools.includes('contrast') ? tools.filter((tool) => tool !== 'contrast') : [...tools, 'contrast'])}>◐ CONTRASTE</button><button aria-pressed={viewerTools.includes('crosshair')} onClick={() => setViewerTools((tools) => tools.includes('crosshair') ? tools.filter((tool) => tool !== 'crosshair') : [...tools, 'crosshair'])}>＋ CRUZ</button><button aria-pressed={viewerTools.includes('ruler')} onClick={() => { setViewerTools((tools) => tools.includes('ruler') ? tools.filter((tool) => tool !== 'ruler') : [...tools, 'ruler']); runViewerCommand('scale'); }}>⌖ ESCALA</button><button onClick={() => runViewerCommand('reset')}>↺ REINICIAR</button></div>

    <main className={`viewer-main ${viewerTools.map((tool) => `tool-${tool}`).join(' ')}`}>
      {section === 'system' && <section id="system" className="story-section story-system active-view">
        <div className="section-heading">
          <div><span className="eyebrow"><span className="status-dot" /> INFORME INTERACTIVO · ARGENTINA</span>
            <h1>Radiografía de nuestro<br /><em>sistema de salud</em></h1>
            <p>Una mirada a las distancias, recursos y desigualdades detrás del mapa sanitario argentino.</p>
          </div>
          <button className="explore-button" onClick={() => navigate('access')}>Explorar el acceso <Icon name="arrow" /></button>
        </div>
        <div className="story-grid system-grid">
          <div className="map-frame">
            <div className="map-topline"><span><i className="map-live-dot" /> DISTRIBUCIÓN DE EFECTORES</span><span>REFES · {metrics?.source_years.refes ?? '—'}</span></div>
            <MapCanvas active mode="system" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} />
            <ViewerHud />
            <div className="map-legend"><span className="legend-glow" /> <span>Efectores REFES geolocalizados</span><span className="legend-separator" /><span className="boundary-swatch" /> Provincias</div>
            <div className="map-scale">{selectedCategories.length ? `${selectedCategories.length} tipología${selectedCategories.length === 1 ? '' : 's'} · ` : ''}{provinceName}<span className="dicom-meta">ZOOM: AUTO · ROT: 0 · L: 128 W: 256</span></div>
          </div>
          <aside className="metrics-column">
            <div className="metric-card metric-facilities" role="button" tabIndex={0} onClick={() => setDrawer('facilities')} onKeyDown={(e) => e.key === 'Enter' && setDrawer('facilities')}>
              <div className="metric-card-label"><span className="metric-icon"><Icon name="pin" /></span><span>ESTABLECIMIENTOS REFES</span><span className="metric-open">↗</span></div>
              <strong className="metric-number">{fmt(metrics?.facility_counts.total)}</strong>
              <span className="metric-sub">efectores registrados · ver tipologías</span>
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
            <div className="ratio-card"><div><span className="eyebrow">ENFERMERÍA POR CADA MÉDICO</span><strong>{fmtRate(metrics?.professionals.nurses_per_doctor)} <small>: 1</small></strong></div><div className="ratio-target"><span>REFERENCIA</span><b>2 : 1</b></div><div className="ratio-bar"><span style={{ width: `${Math.min((metrics?.professionals.nurses_per_doctor ?? 0) / 2 * 100, 100)}%` }} /></div><p>La referencia recomendada es de 2 profesionales de enfermería por cada médico.</p></div>
            <button className="filter-tipology" onClick={() => setDrawer('facilities')}><Icon name="filter" /> {selectedCategories.length ? 'Editar filtro de tipologías' : 'Explorar tipologías'} <span>{selectedCategories.length ? selectedCategories.length : categories.length}</span></button>
          </aside>
        </div>
        <div className="section-footnote"><span>01 / 03</span><span>Datos de establecimientos REFES · profesionales REFEPS · clic en las tarjetas para ver el detalle</span><button onClick={() => navigate('access')}>Seguir la radiografía ↓</button></div>
      </section>

      }

      {section === 'access' && <section id="access" className="story-section story-access active-view">
        <div className="section-heading section-heading-compact">
          <div><span className="eyebrow"><span className="status-dot status-green" /> ACCESO TERRITORIAL · EN AUTO</span>
            <h2>No siempre está <em>igual de cerca.</em></h2>
            <p className="section-deck">No basta con que el esqueleto parezca estar bien en la radiografía. También importa cuánto tarda la atención en llegar.</p>
          </div>
          <div className="province-select-wrap"><label htmlFor="province-select">TERRITORIO</label><select id="province-select" value={provinceId ?? ''} onChange={(e) => { const p = metrics?.provinces[e.target.value]; setProvinceId(e.target.value || null); setProvinceName(p?.name ?? 'Argentina'); }}><option value="">Argentina · nacional</option>{Object.values(metrics?.provinces ?? {}).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((province) => <option key={province.province_id} value={province.province_id}>{province.name}</option>)}</select></div>
        </div>
        <div className="story-grid access-grid">
          <div className="map-frame access-map-frame">
            <div className="map-topline"><span><i className="map-live-dot map-live-green" /> SIMULACION ECO · ACCESO TERRITORIAL</span><span>{provinceName.toUpperCase()}</span></div>
            <MapCanvas active mode="access" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} />
            <ViewerHud />
            {!!generationReport?.omitted_facility_count && <div className="isochrone-warning" role="status">No se pudieron calcular isÃ³cronas para {fmt(generationReport.omitted_facility_count)} establecimientos. <a href="/data/access/generation-report.json" target="_blank" rel="noreferrer">Ver reporte</a></div>}
            <div className="isochrone-legend">{[5, 15, 30, 60].filter((minutes) => minutes <= threshold).map((minutes) => <span key={minutes}><i className={`iso-chip iso-${({ 5: 'red', 15: 'yellow', 30: 'green', 60: 'blue' } as const)[minutes as 5 | 15 | 30 | 60]}`} />{minutes} min</span>)}</div>
            <div className="doppler-scale" aria-label="Escala visual inspirada en Doppler, no es una medicion"><span>-0.66</span><i /><span>0</span><i /><span>+0.66</span></div>
            {partialAccess && <div className="isochrone-warning isochrone-partial" role="status">Vista parcial: {fmt(accessManifest?.completed_jobs)} de {fmt(accessManifest?.total_jobs)} lotes procesados. Las áreas y coberturas pueden aumentar cuando termine el cálculo.</div>}
            {!accessManifest && <div className="map-empty-state"><span className="empty-icon">⌁</span><strong>Isócronas en preparación</strong><span>Generá los archivos de acceso con el flujo ORS documentado en scripts/generate_isochrones.py para activar esta capa.</span></div>}
            <div className="map-scale">Click en una provincia para enfocar el territorio</div>
          </div>
          <aside className="metrics-column access-metrics">
            <div className="access-filter-row"><label htmlFor="threshold-select">UMBRAL DE VIAJE</label><select id="threshold-select" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}><option value="60">60 minutos</option><option value="30">30 minutos</option><option value="15">15 minutos</option><option value="5">5 minutos</option></select></div>
            <div className="metric-card access-primary"><span className="eyebrow">{partialAccess ? `ALCANZADOS EN HASTA ${threshold} MIN · MÍNIMO` : `ASENTAMIENTOS A MÁS DE ${threshold} MIN`}</span><strong className="metric-number">{access ? `${fmt(Math.round((partialAccess ? access.covered : access.total - access.covered) / Math.max(access.total, 1) * 100))}%` : '—'}</strong><span className="metric-sub">{access ? partialAccess ? `${fmt(access.covered)} de ${fmt(access.total)} alcanzados hasta ahora; el valor puede subir.` : `${fmt(access.total - access.covered)} de ${fmt(access.total)} asentamientos BAHRA` : 'Se habilita al generar las áreas de isócrona'}</span><div className="access-denominator">{fmt(selectedProvince?.settlement_count ?? metrics?.settlement_count)} asentamientos considerados en {provinceName}</div></div>
            <button className="metric-card rate-card" onClick={() => setDrawer('doctors')}><div className="rate-title"><span>MÉDICOS / 1.000 HAB.</span><span className="metric-open">↗</span></div><strong>{fmtRate(doctorsRate)}</strong><span>población Censo 2022 · clic para desglose</span></button>
            <button className="metric-card rate-card" onClick={() => setDrawer('nurses')}><div className="rate-title"><span>ENFERMERÍA / 1.000 HAB.</span><span className="metric-open">↗</span></div><strong>{fmtRate(nursesRate)}</strong><span>población Censo 2022 · clic para desglose</span></button>
            <div className="ratio-inline"><div><span>ENFERMERÍA : MEDICINA</span><b>{fmtRate(selectedProvince?.nurses_per_doctor ?? metrics?.professionals.nurses_per_doctor)} : 1</b></div><span className="data-period">REFePS 2023 / Censo {metrics?.source_years.population ?? 2022} · población: {fmt(selectedProvince?.population_2022 ?? nationalPopulation)}</span></div>
            <div className="clinical-panel"><span className="eyebrow">¿POR QUÉ IMPORTA EL TIEMPO?</span><article><b>60 MIN · TRAUMA GRAVE</b><p>Para hemorragias importantes y lesiones graves, la rapidez de la evaluación, el control del sangrado y el acceso a un centro con capacidad de trauma pueden ser decisivos. La llamada “hora dorada” sirve como referencia del sistema; no es un límite clínico universal.</p></article><article><b>30 MIN · ACV SOSPECHADO</b><p>Ante signos de ACV, llegar pronto facilita la evaluación neurológica y las imágenes que permiten decidir si corresponde un tratamiento de reperfusión. Cada caso y su ventana terapéutica se valoran clínicamente.</p></article><article><b>15 MIN · PARO CARDÍACO</b><p>En un paro, iniciar RCP y usar un desfibrilador cuanto antes es fundamental. La banda de 15 minutos ayuda a identificar zonas con mayor o menor proximidad territorial a efectores de salud, como referencia para analizar acceso a evaluación y atención de emergencia. El cálculo no incluye despacho, llegada de ambulancia ni atención de testigos.</p></article><article><b>5 MIN · PARO RESPIRATORIO / ASFIXIA</b><p>La obstrucción grave de la respiración requiere respuesta inmediata y acceso rápido a soporte de vía aérea y reanimación. Esta banda muestra cercanía estimada a efectores, no un plazo individual de daño ni reemplaza la respuesta prehospitalaria.</p></article><small>Los umbrales son referencias para analizar acceso en auto hasta efectores REFES. No predicen resultados individuales ni describen tiempos completos de emergencia. La “escala Doppler” es un recurso visual, no una medición clínica.</small><div className="clinical-sources"><a href="https://www.facs.org/quality-programs/trauma/systems/trauma-series/part-iv/" target="_blank" rel="noreferrer">ACS · TRAUMA</a><a href="https://professional.heart.org/en/science-news/~/link.aspx?_id=BAB8B4E3D2C7472F942AA69EEE8D7B79&_z=z" target="_blank" rel="noreferrer">AHA · ACV</a><a href="https://www.heart.org/en/health-topics/cardiac-arrest/emergency-treatment-of-cardiac-arrest" target="_blank" rel="noreferrer">AHA · RCP/AED</a></div></div>
            <div className="access-method"><span className="method-pulse" />{selectedCategories.length ? `${selectedCategories.length} tipologías seleccionadas` : 'Todas las tipologías REFES'}<button onClick={() => setDrawer('facilities')}>Cambiar <Icon name="arrow" /></button></div>
          </aside>
        </div>
        <div className="section-footnote"><span>02 / 03</span><span>Porcentaje de asentamientos BAHRA, sin ponderar por población · tiempos de viaje estimados</span><button onClick={() => navigate('route')}>Encontrá tu centro ↓</button></div>
      </section>

      }

      {section === 'route' && <section id="route" className="story-section story-route active-view">
        <div className="section-heading section-heading-compact">
          <div><span className="eyebrow"><span className="status-dot status-green" /> UNA PREGUNTA PERSONAL</span>
            <h2>Análisis territorial<br /><em>y tu recorrido</em></h2>
            <p className="section-deck">Buscá una dirección y trazamos el recorrido en auto hasta el efector de la tipología elegida con menor tiempo estimado de viaje.</p>
          </div>
        </div>
        <div className="story-grid route-grid">
          <div className="map-frame route-map-frame"><div className="map-topline"><span><i className="map-live-dot map-live-green" /> RECORRIDO EN RED VIAL</span><span>OPENSTREETMAP · ROUTING</span></div><MapCanvas active mode="route" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} /><ViewerHud />
            {route && <div className="route-result-card"><div className="route-result-icon"><Icon name="pin" /></div><div className="route-result-copy"><span>CENTRO MÁS CERCANO · {route.facility.category}</span><strong>{route.facility.name}</strong><small>{route.facility.locality}, {route.facility.province}</small></div><div className="route-result-time"><strong>{Math.max(1, Math.round(route.duration_seconds / 60))}<small> min</small></strong><span>{(route.distance_meters / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km</span></div></div>}
            {!route && <div className="route-map-note"><span>⌖</span>Tu recorrido aparece acá</div>}
          </div>
          <aside className="route-search-panel">
            <div className="route-number">01 <span>· TU PUNTO DE PARTIDA</span></div>
            <form onSubmit={searchNearest}>
              <label htmlFor="address">Ingresá una dirección en Argentina</label>
              <div className="address-input"><Icon name="search" /><input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ej. Av. Corrientes 1234, CABA" autoComplete="street-address" /></div>
              <label htmlFor="route-category">¿Qué tipo de centro buscás?</label>
              <select id="route-category" value={selectedCategories.length === 1 ? selectedCategories[0] : ''} onChange={(e) => setSelectedCategories(e.target.value ? [e.target.value] : [])}><option value="">Cualquier efector REFES</option>{categories.map((category) => <option key={category.name} value={category.name}>{category.name}</option>)}</select>
              <button className="route-submit" type="submit" disabled={loadingRoute}>{loadingRoute ? <><span className="spinner" /> Buscando recorrido…</> : <>Encontrar mi centro <Icon name="arrow" /></>}</button>
            </form>
            {routeMessage && <div className="route-message" role="status">{routeMessage}</div>}
            <div className="route-steps"><div><span>1</span><p>Ubicamos tu dirección en el mapa.</p></div><div><span>2</span><p>Comparamos el tiempo de viaje a efectores cercanos.</p></div><div><span>3</span><p>Mostramos la ruta en la red vial de OpenStreetMap.</p></div></div>
            <p className="privacy-note">La dirección se envía a OpenStreetMap y OpenRouteService para calcular el recorrido. No guardamos la búsqueda en esta aplicación.</p>
          </aside>
        </div>
        <div className="section-footnote"><span>03 / 03</span><span>Ruta y tiempo estimados; pueden diferir del tránsito y las condiciones reales</span><button onClick={() => navigate('system')}>Volver al inicio ↑</button></div>
      </section>
      }
    </main>
    <div className="viewer-bottom"><button onClick={() => moveView(-1)}>◀ ANTERIOR</button><span>VISTA {SECTIONS.findIndex((item) => item.id === section) + 1} DE 3</span><button onClick={() => moveView(1)}>SIGUIENTE ▶</button></div>
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


