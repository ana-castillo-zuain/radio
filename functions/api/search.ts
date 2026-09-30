type Env = { ORS_API_KEY?: string };
type Candidate = {
  id: string;
  name: string;
  locality: string;
  province: string;
  category: string;
  coordinates: [number, number];
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function validPoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number' && Number.isFinite(v))
    && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

async function geocode(query: string, request: Request): Promise<Response> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', countrycodes: 'ar', limit: '1', 'accept-language': 'es' }).toString();
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'RadiografiaSalud/0.1 (interactive health-access map)',
      referer: new URL(request.url).origin,
    },
  });
  if (!response.ok) return json({ error: response.status === 429 ? 'El servicio de búsqueda está ocupado. Esperá un momento y probá de nuevo.' : 'No se pudo consultar el servicio de direcciones.' }, response.status === 429 ? 429 : 502);
  const results = await response.json() as Array<{ lon: string; lat: string; display_name: string }>;
  const result = results[0];
  if (!result) return json({ error: 'No encontramos esa dirección. Probá agregar localidad o provincia.' }, 404);
  return json({ coordinates: [Number(result.lon), Number(result.lat)], label: result.display_name });
}

async function route(origin: [number, number], candidates: Candidate[], apiKey?: string): Promise<Response> {
  if (!apiKey) return json({ error: 'El cálculo de rutas todavía no está configurado. Falta agregar ORS_API_KEY en Cloudflare Pages.' }, 503);
  const locations = [origin, ...candidates.map((candidate) => candidate.coordinates)];
  const headers = { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json, application/geo+json' };
  const matrixResponse = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
    method: 'POST', headers,
    body: JSON.stringify({ locations, sources: [0], destinations: candidates.map((_, index) => index + 1), metrics: ['duration'] }),
  });
  if (!matrixResponse.ok) {
    const detail = await matrixResponse.text();
    return json({ error: matrixResponse.status === 429 ? 'Se alcanzó el límite temporal del proveedor de rutas. Probá más tarde.' : `El proveedor de rutas respondió ${matrixResponse.status}. ${detail.slice(0, 180)}` }, 502);
  }
  const matrix = await matrixResponse.json() as { durations?: (number | null)[][] };
  const durations = matrix.durations?.[0] ?? [];
  let bestIndex = -1;
  let bestDuration = Infinity;
  durations.forEach((duration, index) => {
    if (duration !== null && duration < bestDuration) {
      bestIndex = index;
      bestDuration = duration;
    }
  });
  if (bestIndex < 0) return json({ error: 'No hay una ruta en auto disponible entre esa dirección y los efectores cercanos.' }, 404);
  const destination = candidates[bestIndex];
  const directionsResponse = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST', headers,
    body: JSON.stringify({ coordinates: [origin, destination.coordinates], instructions: false, elevation: false }),
  });
  if (!directionsResponse.ok) return json({ error: 'No se pudo obtener el trazado del recorrido.' }, 502);
  const directions = await directionsResponse.json() as {
    features?: Array<{ geometry: { type: 'LineString'; coordinates: [number, number][] }; properties?: { summary?: { distance?: number; duration?: number } } }>;
  };
  const feature = directions.features?.[0];
  if (!feature) return json({ error: 'El proveedor no devolvió un recorrido para esa dirección.' }, 502);
  return json({
    origin,
    destination: destination.coordinates,
    facility: { id: destination.id, name: destination.name, locality: destination.locality, province: destination.province, category: destination.category },
    distance_meters: feature.properties?.summary?.distance ?? 0,
    duration_seconds: feature.properties?.summary?.duration ?? durations[bestIndex] ?? 0,
    geometry: feature.geometry,
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  try {
    const body = await context.request.json() as { action?: string; query?: string; coordinates?: unknown; origin?: unknown; candidates?: Candidate[] };
    if (body.action === 'geocode') {
      const query = String(body.query ?? '').trim();
      if (query.length < 4 || query.length > 180) return json({ error: 'Ingresá una dirección de entre 4 y 180 caracteres.' }, 400);
      return await geocode(query, context.request);
    }
    if (body.action === 'route') {
      if (!validPoint(body.origin)) return json({ error: 'La ubicación no tiene coordenadas válidas.' }, 400);
      if (!Array.isArray(body.candidates) || body.candidates.length < 1 || body.candidates.length > 8) return json({ error: 'No se recibieron candidatos válidos para calcular la ruta.' }, 400);
      const candidates = body.candidates.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && validPoint(item.coordinates));
      if (!candidates.length) return json({ error: 'No hay efectores con coordenadas válidas para esa búsqueda.' }, 404);
      return await route(body.origin, candidates, context.env.ORS_API_KEY);
    }
    return json({ error: 'Acción no reconocida.' }, 400);
  } catch {
    return json({ error: 'La solicitud no pudo procesarse. Intentá nuevamente.' }, 400);
  }
}
