import type { FeatureCollection } from './types';

type AccessPolygon = {
  properties: { province_id?: string; category?: string; threshold?: number };
  geometry: { type: string; coordinates: unknown };
};

type SettlementCollection = FeatureCollection<{ province_id?: string }>;

function insideRing(point: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function insidePolygon(point: [number, number], polygon: [number, number][][]): boolean {
  if (!polygon.length || !insideRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => insideRing(point, hole));
}

function contains(feature: AccessPolygon, point: [number, number]): boolean {
  const coords = feature.geometry.coordinates as [number, number][][] | [number, number][][][];
  if (feature.geometry.type === 'Polygon') return insidePolygon(point, coords as [number, number][][]);
  if (feature.geometry.type === 'MultiPolygon') return (coords as [number, number][][][]).some((polygon) => insidePolygon(point, polygon));
  return false;
}

export function coveredSettlementCount(
  settlements: SettlementCollection | null,
  polygons: FeatureCollection<AccessPolygon['properties']> | null,
  provinceId: string | null,
  categories: string[],
  threshold: number,
): { covered: number; total: number } | null {
  if (!settlements || !polygons?.features.length) return null;
  const subset = settlements.features.filter((feature) => !provinceId || String(feature.properties.province_id) === provinceId);
  const zones = polygons.features.filter((feature) => {
    if (Number(feature.properties.threshold) !== threshold) return false;
    if (provinceId && String(feature.properties.province_id) !== provinceId) return false;
    if (categories.length && !categories.includes(String(feature.properties.category ?? ''))) return false;
    return true;
  }) as AccessPolygon[];
  if (!zones.length) return null;
  const covered = subset.reduce((count, feature) => {
    const point = feature.geometry.coordinates as [number, number];
    return count + (zones.some((zone) => contains(zone, point)) ? 1 : 0);
  }, 0);
  return { covered, total: subset.length };
}
