import currency from "currency.js";

/** Linha do rateio de um lançamento entre centros de custo. */
export interface AllocationRow {
  costCenterId: string;
  percentage: number;
  amount: number;
}

/**
 * R$ de cada linha pelo %. Com 100% fechado, o centavo do arredondamento vai
 * para a última linha que tem percentual (nunca para uma recém-criada a 0%).
 * Check: `node scripts/check-allocation.mjs`.
 */
export function amountsFromPercent<T extends AllocationRow>(
  rows: T[],
  total: number,
): T[] {
  const t = currency(total);
  const pct = rows.reduce((s, a) => s + (a.percentage || 0), 0);
  const out = rows.map((a) => ({
    ...a,
    amount: t.multiply(a.percentage || 0).divide(100).value,
  }));
  if (Math.abs(pct - 100) >= 0.1) return out;
  let absorber = -1;
  out.forEach((a, i) => {
    if ((a.percentage || 0) > 0) absorber = i;
  });
  if (absorber < 0) return out;
  const others = out.reduce(
    (s, a, i) => (i === absorber ? s : s.add(a.amount)),
    currency(0),
  );
  out[absorber].amount = t.subtract(others).value;
  return out;
}

/** Percentuais iguais para n linhas, com a sobra de arredondamento na última. */
export function evenPercentages(n: number) {
  const base = Math.floor(10000 / n) / 100;
  return Array.from({ length: n }, (_, i) =>
    i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base,
  );
}
