type MangoCpiEvent = {
  time_period: string; // YYYY-Qn
  cpi_value: number;
};

type MangoUnempEvent = {
  time_period: string; // YYYY-MM
  unemployment_value: number;
};

function quarterEnd(period: string): string | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const q = Number.parseInt(m[2], 10);
  const month = q * 3; // 3,6,9,12
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month
  return `${m[1]}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
}

function monthEnd(period: string): string | null {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(endDay).padStart(2, "0")}`;
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export type MacroSeries = {
  cpi: Array<{ date: string; value: number; change: number }>;
  unemp: Array<{ date: string; value: number; change: number }>;
};

export async function fetchMacroSeries(params: {
  cpi_start: string;
  cpi_end: string;
  unemp_start: string;
  unemp_end: string;
}): Promise<{ ok: true; series: MacroSeries } | { ok: false; reason: string }> {
  const base = process.env.MANGO_BASE_URL;
  if (!base) return { ok: false, reason: "Missing environment variable: MANGO_BASE_URL" };
  try {
    const cpiUrl = `${base}/public/cpi?start=${encodeURIComponent(params.cpi_start)}&end=${encodeURIComponent(params.cpi_end)}`;
    const unempUrl = `${base}/public/unemployment?start=${encodeURIComponent(params.unemp_start)}&end=${encodeURIComponent(params.unemp_end)}`;

    const [cpiRaw, unempRaw] = await Promise.all([
      fetchJson(cpiUrl, 10_000),
      fetchJson(unempUrl, 10_000),
    ]);

    const cpiEvents = (cpiRaw?.events ?? []) as MangoCpiEvent[];
    const unempEvents = (unempRaw?.events ?? []) as MangoUnempEvent[];

    const cpi = cpiEvents
      .map((e) => {
        const d = quarterEnd(e.time_period);
        return d ? { date: d, value: Number(e.cpi_value) } : null;
      })
      .filter(Boolean) as Array<{ date: string; value: number }>;
    cpi.sort((a, b) => a.date.localeCompare(b.date));

    const unemp = unempEvents
      .map((e) => {
        const d = monthEnd(e.time_period);
        return d ? { date: d, value: Number(e.unemployment_value) } : null;
      })
      .filter(Boolean) as Array<{ date: string; value: number }>;
    unemp.sort((a, b) => a.date.localeCompare(b.date));

    const cpiWithChange = cpi.map((e, i) => {
      const prev = cpi[i - 1]?.value;
      const change = prev && prev !== 0 ? (e.value - prev) / prev : 0;
      return { ...e, change };
    });
    const unempWithChange = unemp.map((e, i) => {
      const prev = unemp[i - 1]?.value;
      const change = typeof prev === "number" ? e.value - prev : 0;
      return { ...e, change };
    });

    return { ok: true, series: { cpi: cpiWithChange, unemp: unempWithChange } };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}

export function macroAtDate(series: MacroSeries | null, date: string) {
  const fallback = { cpi_level: 0, cpi_qoq: 0, unemp_level: 0, unemp_mom: 0 };
  if (!series) return fallback;

  // Linear scan pointers are handled by caller; here we do a simple binary-ish scan (small series).
  function lastLE<T extends { date: string }>(arr: T[]): T | null {
    let lo = 0;
    let hi = arr.length - 1;
    let best: T | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = arr[mid]?.date ?? "";
      if (d <= date) {
        best = arr[mid] ?? null;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  const cpi = lastLE(series.cpi) as any;
  const un = lastLE(series.unemp) as any;

  return {
    cpi_level: cpi ? Number(cpi.value) : 0,
    cpi_qoq: cpi ? Number(cpi.change) : 0,
    unemp_level: un ? Number(un.value) : 0,
    unemp_mom: un ? Number(un.change) : 0,
  };
}
