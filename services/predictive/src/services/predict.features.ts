export type DailyBar = {
  date: string; // YYYY-MM-DD (UTC)
  close: number;
};

export type FeatureRow = {
  date: string;
  x: number[];
  y?: number;
};

export const FEATURE_LIST = [
  "ret_1d",
  "ret_5d",
  "ret_20d",
  "vol_5d",
  "vol_20d",
  "drawdown_20d",
  "cpi_level",
  "cpi_qoq",
  "unemp_level",
  "unemp_mom",
] as const;

export function std(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const varSum = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, varSum));
}

export function maxDrawdown(closes: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) worst = Math.min(worst, c / peak - 1);
  }
  // Return magnitude (positive number).
  return Math.abs(worst);
}

export function computeFeatureVector(
  series: DailyBar[],
  idx: number,
  macro: { cpi_level: number; cpi_qoq: number; unemp_level: number; unemp_mom: number },
): number[] | null {
  if (idx < 20) return null;
  const close = series[idx]?.close;
  const close1 = series[idx - 1]?.close;
  const close5 = series[idx - 5]?.close;
  const close20 = series[idx - 20]?.close;
  if (![close, close1, close5, close20].every((v) => typeof v === "number" && Number.isFinite(v))) return null;

  const ret_1d = close / close1 - 1;
  const ret_5d = close / close5 - 1;
  const ret_20d = close / close20 - 1;

  const rets: number[] = [];
  for (let i = idx - 20 + 1; i <= idx; i++) {
    const c0 = series[i - 1]?.close;
    const c1v = series[i]?.close;
    if (typeof c0 === "number" && typeof c1v === "number" && c0 !== 0) rets.push(c1v / c0 - 1);
  }
  const vol_5d = std(rets.slice(-5));
  const vol_20d = std(rets.slice(-20));
  const drawdown_20d = maxDrawdown(series.slice(idx - 20, idx + 1).map((b) => b.close));

  return [
    ret_1d,
    ret_5d,
    ret_20d,
    vol_5d,
    vol_20d,
    drawdown_20d,
    macro.cpi_level,
    macro.cpi_qoq,
    macro.unemp_level,
    macro.unemp_mom,
  ];
}

export function computeLabel(series: DailyBar[], idx: number, horizonDays: number, spikeThreshold: number): 0 | 1 | null {
  const end = Math.min(series.length - 1, idx + horizonDays);
  if (end <= idx) return null;
  for (let j = idx + 1; j <= end; j++) {
    const c0 = series[j - 1]?.close;
    const c1v = series[j]?.close;
    if (typeof c0 !== "number" || typeof c1v !== "number" || c0 === 0) continue;
    const r = c1v / c0 - 1;
    if (Math.abs(r) >= spikeThreshold) return 1;
  }
  return 0;
}

