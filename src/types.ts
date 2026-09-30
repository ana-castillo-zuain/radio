export type FeatureCollection<P = Record<string, unknown>> = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: P;
  }>;
};

export type FacilityProperties = {
  id: string;
  name: string;
  locality: string;
  province: string;
  province_id: string;
  category: string;
  category_code: string;
  coordinate_status: string;
};

export type Facility = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: FacilityProperties;
};

export type FacilityCollection = { type: 'FeatureCollection'; features: Facility[] };

export type OriginCounts = Record<string, number>;

export type ProfessionalProvince = {
  habilitados: number;
  activos: number;
  origen_activos: OriginCounts;
};

export type ProvinceMetrics = {
  province_id: string;
  name: string;
  population_2022: number;
  settlement_count: number;
  refes_total: number;
  doctors: ProfessionalProvince;
  nurses: ProfessionalProvince;
  nurse_specialties_active: Record<string, number>;
  doctors_per_1000: number;
  nurses_per_1000: number;
  nurses_per_doctor: number | null;
};

export type Category = { name: string; count: number; codes: string[] };

export type Metrics = {
  source_years: { refes: number; professionals: number; population: number };
  definitions: Record<string, string>;
  facility_counts: {
    valid_argentina_bounds: number;
    recovered_from_healthsites: number;
    missing_or_non_numeric: number;
    total: number;
    mapped: number;
  };
  facility_categories: Category[];
  professionals: {
    doctors_active: number;
    nurses_active: number;
    doctors: Record<string, ProfessionalProvince>;
    nurses: Record<string, ProfessionalProvince>;
    nurse_specialties_active: Record<string, Record<string, number>>;
    doctors_per_1000: number;
    nurses_per_1000: number;
    nurses_per_doctor: number;
  };
  provinces: Record<string, ProvinceMetrics>;
  settlement_count: number;
  population_audit: { sum_of_provinces: number; reported_country_total: number | null; difference: number | null };
};

export type RouteResult = {
  origin: [number, number];
  destination: [number, number];
  address: string;
  facility: FacilityProperties;
  distance_meters: number;
  duration_seconds: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
};
