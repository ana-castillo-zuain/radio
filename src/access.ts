export type SettlementCoverage = {
  settlement_id: string | number;
  province_id: string;
  reachable: Record<'10' | '20' | '30' | '60', string[]>;
};

export function coveredSettlementCount(
  rows: SettlementCoverage[] | null,
  provinceId: string | null,
  categories: string[],
  thresholdMinutes: number,
): { covered: number; total: number } | null {
  if (!rows?.length) return null;
  const key = String(thresholdMinutes) as '10' | '20' | '30' | '60';
  const subset = provinceId ? rows.filter((row) => row.province_id === provinceId) : rows;
  if (!subset.length) return null;
  const covered = subset.reduce((count, row) => {
    const reachable = row.reachable?.[key] ?? [];
    return count + (categories.length === 0 ? Number(reachable.length > 0) : Number(categories.some((category) => reachable.includes(category))));
  }, 0);
  return { covered, total: subset.length };
}
