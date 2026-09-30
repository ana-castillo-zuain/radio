import { useEffect, useMemo, useState } from 'react';
import MapCanvas from './MapCanvas';
import { coveredSettlementCount } from './access';
import type { Category, FacilityCollection, FeatureCollection, Metrics, ProvinceMetrics, RouteResult } from './types';

type Section = 'system' | 'access' | 'route';
type DrawerKind = 'facilities' | 'doctors' | 'nurses' | null;

const SECTIONS: { id: Section; number: string; name: string }[] = [
  { id: 'system', number: '01', name: 'El sistema que vemos' },
  { id: 'access', number: '02', name: 'No siempre está igual de cerca' },
  { id: 'route', number: '03', name: '¿Dónde quedás vos?' },
];
const TOUR_STEPS = [
  { label: '01 · DISTRIBUCIÓN', title: 'Leé el mapa del sistema', body: 'Cada punto es un efector del REFES con coordenadas válidas o recuperadas desde Healthsites. El resplandor ayuda a ver concentraciones; acercate para distinguir establecimientos individuales.' },
  { label: '02 · RECURSOS', title: 'Abrí los indicadores', body: 'Las tarjetas de médicos y enfermería muestran profesionales activos hasta los 64 años inclusive. Al abrirlas vas a encontrar origen, habilitados de todas las edades y, para enfermería, formación.' },
  { label: '03 · ACCESO', title: 'Compará tiempos de viaje', body: 'Elegí provincia, tipología y umbral. El porcentaje cuenta asentamientos BAHRA, sin ponderarlos por población. La capa de isócronas se activa cuando se complete y valide el cálculo sobre la red vial.' },
  { label: '04 · TU RECORRIDO', title: 'Buscá un centro cercano', body: 'Ingresá una dirección y elegí qué tipo de efector necesitás. La aplicación geocodifica la búsqueda y compara rutas en auto; los tiempos son estimados y pueden diferir del tránsito real.' },
];

const fmt = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('es-AR').format(n);
const fmtRate = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const [settlements, setSettlements] = useState<FeatureCollection<{ province_id: string }> | null>(null);
  const [isochrones, setIsochrones] = useState<FeatureCollection<{ province_id?: string; category?: string; threshold?: number }> | null>(null);
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

  useEffect(() => {
    Promise.all([
      fetch('/data/metrics.json').then((r) => { if (!r.ok) throw new Error('No están los datos preparados. Ejecutá primero npm run prepare-data.'); return r.json() as Promise<Metrics>; }),
      fetch('/data/facilities.geojson').then((r) => { if (!r.ok) throw new Error('No se encontró el mapa de efectores.'); return r.json() as Promise<FacilityCollection>; }),
      fetch('/data/settlements.geojson').then((r) => r.ok ? r.json() as Promise<FeatureCollection<{ province_id: string }>> : null),
      fetch('/data/access-isochrones.geojson').then((r) => r.ok ? r.json() as Promise<FeatureCollection<{ province_id?: string; category?: string; threshold?: number }>> : null),
    ]).then(([m, f, s, iso]) => { setMetrics(m); setFacilities(f); setSettlements(s); setIsochrones(iso); })
      .catch((error: Error) => setDataError(error.message));
  }, []);

  const categories = metrics?.facility_categories ?? [];
  const selectedProvince = provinceId && metrics ? metrics.provinces[provinceId] ?? null : null;
  const access = useMemo(() => coveredSettlementCount(settlements, isochrones, provinceId, selectedCategories, threshold), [settlements, isochrones, provinceId, selectedCategories, threshold]);
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
    document.getElementById(next)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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
      <a className="brand" href="#system" onClick={(event) => { event.preventDefault(); navigate('system'); }}>
        <span className="brand-mark"><span /><span /><span /></span><span>RADIOGRAFÍA <i>·</i> SALUD ARGENTINA</span>
      </a>
      <nav className="main-nav" aria-label="Secciones">
        {SECTIONS.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span>{item.number}</span>{item.name}</button>)}
      </nav>
      <div className="header-actions"><button className="guide-button" onClick={() => setTourStep(0)}>Guía rápida <span>↗</span></button><a className="source-link" href="#fuentes">Fuentes <span>↗</span></a></div>
    </header>

    {dataError && <div className="data-error" role="alert"><strong>Falta preparar los datos.</strong> {dataError}</div>}

    <main>
      <section id="system" className="story-section story-system">
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
            <MapCanvas mode="system" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} />
            <div className="map-legend"><span className="legend-glow" /> <span>Efectores REFES geolocalizados</span><span className="legend-separator" /><span className="boundary-swatch" /> Provincias</div>
            <div className="map-scale">{selectedCategories.length ? `${selectedCategories.length} tipología${selectedCategories.length === 1 ? '' : 's'} · ` : ''}{provinceName}</div>
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

      <section id="access" className="story-section story-access">
        <div className="section-heading section-heading-compact">
          <div><span className="eyebrow"><span className="status-dot status-green" /> ACCESO TERRITORIAL · EN AUTO</span>
            <h2>No siempre está <em>igual de cerca.</em></h2>
            <p className="section-deck">No basta con que el esqueleto parezca estar bien en la radiografía. También importa cuánto tarda la atención en llegar.</p>
          </div>
          <div className="province-select-wrap"><label htmlFor="province-select">TERRITORIO</label><select id="province-select" value={provinceId ?? ''} onChange={(e) => { const p = metrics?.provinces[e.target.value]; setProvinceId(e.target.value || null); setProvinceName(p?.name ?? 'Argentina'); }}><option value="">Argentina · nacional</option>{Object.values(metrics?.provinces ?? {}).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((province) => <option key={province.province_id} value={province.province_id}>{province.name}</option>)}</select></div>
        </div>
        <div className="story-grid access-grid">
          <div className="map-frame access-map-frame">
            <div className="map-topline"><span><i className="map-live-dot map-live-green" /> SUPERFICIE DE ACCESO EN AUTO</span><span>{provinceName.toUpperCase()}</span></div>
            <MapCanvas mode="access" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} />
            <div className="isochrone-legend">{[0, 1, 2, 3].map((band) => <span key={band}><i className={`iso-chip iso-${['red', 'yellow', 'green', 'blue'][band]}`} />{fmtRate(threshold * band / 4)}–{fmtRate(threshold * (band + 1) / 4)} min</span>)}</div>
            {!isochrones?.features.length && <div className="map-empty-state"><span className="empty-icon">⌁</span><strong>Isócronas en preparación</strong><span>Esta capa necesita el cálculo de rutas sobre la red vial. No mostramos distancias en línea recta como si fueran tiempos de viaje.</span></div>}
            <div className="map-scale">Click en una provincia para enfocar el territorio</div>
          </div>
          <aside className="metrics-column access-metrics">
            <div className="access-filter-row"><label htmlFor="threshold-select">UMBRAL DE VIAJE</label><select id="threshold-select" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}><option value="60">60 minutos</option><option value="30">30 minutos</option><option value="20">20 minutos</option><option value="10">10 minutos</option></select></div>
            <div className="metric-card access-primary"><span className="eyebrow">ASENTAMIENTOS A MÁS DE {threshold} MIN</span><strong className="metric-number">{access ? `${fmt(Math.round((1 - access.covered / Math.max(access.total, 1)) * 100))}%` : '—'}</strong><span className="metric-sub">{access ? `${fmt(access.total - access.covered)} de ${fmt(access.total)} asentamientos BAHRA` : 'Se habilita al generar las áreas de isócrona'}</span><div className="access-denominator">{fmt(selectedProvince?.settlement_count ?? metrics?.settlement_count)} asentamientos considerados en {provinceName}</div></div>
            <button className="metric-card rate-card" onClick={() => setDrawer('doctors')}><div className="rate-title"><span>MÉDICOS / 1.000 HAB.</span><span className="metric-open">↗</span></div><strong>{fmtRate(doctorsRate)}</strong><span>población Censo 2022 · clic para desglose</span></button>
            <button className="metric-card rate-card" onClick={() => setDrawer('nurses')}><div className="rate-title"><span>ENFERMERÍA / 1.000 HAB.</span><span className="metric-open">↗</span></div><strong>{fmtRate(nursesRate)}</strong><span>población Censo 2022 · clic para desglose</span></button>
            <div className="ratio-inline"><div><span>ENFERMERÍA : MEDICINA</span><b>{fmtRate(selectedProvince?.nurses_per_doctor ?? metrics?.professionals.nurses_per_doctor)} : 1</b></div><span className="data-period">REFePS 2023 / Censo {metrics?.source_years.population ?? 2022} · población: {fmt(selectedProvince?.population_2022 ?? nationalPopulation)}</span></div>
            <div className="access-method"><span className="method-pulse" />{selectedCategories.length ? `${selectedCategories.length} tipologías seleccionadas` : 'Todas las tipologías REFES'}<button onClick={() => setDrawer('facilities')}>Cambiar <Icon name="arrow" /></button></div>
          </aside>
        </div>
        <div className="section-footnote"><span>02 / 03</span><span>Porcentaje de asentamientos BAHRA, sin ponderar por población · tiempos de viaje estimados</span><button onClick={() => navigate('route')}>Encontrá tu centro ↓</button></div>
      </section>

      <section id="route" className="story-section story-route">
        <div className="section-heading section-heading-compact">
          <div><span className="eyebrow"><span className="status-dot status-green" /> UNA PREGUNTA PERSONAL</span>
            <h2>¿A cuánto estás de tu centro<br /><em>de salud más cercano?</em></h2>
            <p className="section-deck">Buscá una dirección y trazamos el recorrido en auto hasta el efector de la tipología elegida con menor tiempo estimado de viaje.</p>
          </div>
        </div>
        <div className="story-grid route-grid">
          <div className="map-frame route-map-frame"><div className="map-topline"><span><i className="map-live-dot map-live-green" /> RECORRIDO EN RED VIAL</span><span>OPENSTREETMAP · ROUTING</span></div><MapCanvas mode="route" provinceId={provinceId} categories={selectedCategories} threshold={threshold} route={route} onProvince={chooseProvince} />
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
    </main>

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

    <footer id="fuentes" className="site-footer"><div className="footer-title"><span className="brand-mark"><span /><span /><span /></span><strong>Una radiografía abierta<br />del sistema de salud.</strong></div><div className="footer-sources"><span className="eyebrow">FUENTES Y MÉTODO</span><p>REFES · establecimientos asistenciales {metrics?.source_years.refes ?? 2026}. REFEPS · stock de profesionales al 31/12/2023. INDEC · población del Censo 2022 y marco geoestadístico. BAHRA · asentamientos humanos. OpenStreetMap · cartografía vial.</p><p>Profesionales activos: hasta 64 años inclusive. Los porcentajes de acceso cuentan asentamientos, no personas. La capa de isócronas se publicará cuando se complete el procesamiento de red vial y se valide una provincia piloto.</p>{metrics?.population_audit.difference ? <p>Control del denominador: la suma de las 24 poblaciones provinciales difiere en {fmt(Math.abs(metrics.population_audit.difference))} personas del total nacional que figura en el archivo.</p> : null}</div><div className="footer-mark">CONTAR CON DATOS<br /><span>2026</span></div></footer>
  </div>;
}

export default App;
