import { AdageEvent } from "../../../../shared/types/adage.type";
import { FEATURE_LIST, DailyBar, computeFeatureVector, computeLabel } from "./predict.features";
import { fitLogisticRegression, predictProbability } from "./predict.model";
import { fetchMacroSeries, macroAtDate } from "./predict.mango";
import { fetchGridShock, shockLevel } from "./predict.gridx";
import { datasetExists, readDataset, readModel, writeModel } from "./predict.storage";
import { ElectricityShockResponse, MacroSummaryResponse, PredictRequest, PredictResponse, TrainRequest, TrainResponse } from "./predict.types";

function badRequest(message: string) {
  const err: any = new Error(message);
  err.status = 400;
  return err;
}

function notFound(message: string) {
  const err: any = new Error(message);
  err.status = 404;
  return err;
}

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseDateToYmd(ts: string): string | null {
  const ms = Date.parse(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupDailyBars(events: AdageEvent[]): Map<string, DailyBar[]> {
  const bySym = new Map<string, DailyBar[]>();
  for (const e of events) {
    if (e.event_type !== "stock_ohlc") continue;
    const sym = String((e.attribute as any)?.symbol ?? "");
    const close = Number((e.attribute as any)?.close);
    const d = parseDateToYmd(e.time_object?.timestamp ?? "");
    if (!sym || !Number.isFinite(close) || !d) continue;
    const arr = bySym.get(sym) ?? [];
    arr.push({ date: d, close });
    bySym.set(sym, arr);
  }
  for (const [sym, arr] of bySym.entries()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    // Deduplicate by date (keep last close in case of duplicates).
    const dedup: DailyBar[] = [];
    for (const b of arr) {
      const prev = dedup[dedup.length - 1];
      if (prev && prev.date === b.date) {
        prev.close = b.close;
      } else {
        dedup.push({ ...b });
      }
    }
    bySym.set(sym, dedup);
  }
  return bySym;
}

function safeNumber(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function riskLevel(p: number): "LOW" | "ELEVATED" | "HIGH" | "CRITICAL" {
  if (p < 0.2) return "LOW";
  if (p < 0.4) return "ELEVATED";
  if (p < 0.6) return "HIGH";
  return "CRITICAL";
}

function applyShockOverlay(pBase: number, shockScore: number): number {
  const p = 1 - Math.pow(1 - pBase, 1 + Math.max(0, shockScore));
  return Math.min(1, Math.max(0, p));
}

function modelId(): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `model_${Date.now()}_${rnd}`;
}

export async function trainModel(userId: string, body: unknown): Promise<TrainResponse> {
  if (!isObj(body)) throw badRequest("Body must be an object");
  const req = body as TrainRequest;
  if (typeof req.dataset_id !== "string" || req.dataset_id.length === 0) throw badRequest("dataset_id is required");

  const horizon_days = typeof req.horizon_days === "number" ? req.horizon_days : 7;
  const spike_threshold = typeof req.spike_threshold === "number" ? req.spike_threshold : 0.05;
  if (!(horizon_days >= 1 && horizon_days <= 30)) throw badRequest("horizon_days must be 1..30");
  if (!(spike_threshold > 0 && spike_threshold < 1)) throw badRequest("spike_threshold must be between 0 and 1");

  const ok = await datasetExists(userId, req.dataset_id);
  if (!ok) throw notFound("DATASET_NOT_FOUND");

  const dataset = await readDataset(userId, req.dataset_id);
  if (!dataset) throw notFound("DATASET_NOT_FOUND");

  const bySym = groupDailyBars(dataset.events ?? []);
  const symbols = Array.isArray(req.symbols) && req.symbols.length > 0 ? req.symbols : [...bySym.keys()];
  const filtered = symbols.filter((s) => bySym.has(s));
  if (filtered.length === 0) throw badRequest("No symbols with usable OHLC data found in dataset");

  let macroReq: TrainRequest["macro"] | null = null;
  if (req.macro) {
    macroReq = req.macro;
    for (const k of ["cpi_start", "cpi_end", "unemp_start", "unemp_end"] as const) {
      if (typeof macroReq[k] !== "string" || macroReq[k].length === 0) throw badRequest(`macro.${k} is required`);
    }
  }

  const macroRes = macroReq ? await fetchMacroSeries(macroReq) : { ok: false as const, reason: "disabled" };
  const macroSeries = macroRes.ok ? macroRes.series : null;

  const X: number[][] = [];
  const y: number[] = [];

  for (const sym of filtered) {
    const series = bySym.get(sym) ?? [];
    for (let i = 20; i < series.length; i++) {
      const macro = macroAtDate(macroSeries, series[i]!.date);
      const x = computeFeatureVector(series, i, macro);
      if (!x) continue;
      const label = computeLabel(series, i, horizon_days, spike_threshold);
      if (label === null) continue;
      X.push(x.map((v) => safeNumber(v, 0)));
      y.push(label);
    }
  }

  if (X.length < 50) throw badRequest(`Not enough training rows (${X.length}). Fetch more history or add more symbols.`);

  const { model, metrics } = fitLogisticRegression([...FEATURE_LIST], X, y);

  const id = modelId();
  const trainedAt = new Date().toISOString();

  const stored = {
    model_id: id,
    trained_at: trainedAt,
    dataset_id: req.dataset_id,
    horizon_days,
    spike_threshold,
    feature_list: model.spec.feature_list,
    scaler: { mean: model.spec.mean, std: model.spec.std },
    bias: model.bias,
    weights: model.weights,
    metrics,
    macro: macroReq
      ? { enabled: true, ...macroReq, ok: macroRes.ok, ...(macroRes.ok ? {} : { reason: macroRes.reason }) }
      : { enabled: false, ok: false, reason: "disabled" },
  };

  await writeModel(userId, id, stored);

  return {
    model_id: id,
    trained_at: trainedAt,
    feature_list: model.spec.feature_list,
    metrics: {
      auc: Number(metrics.auc.toFixed(4)),
      precision: Number(metrics.precision.toFixed(4)),
      recall: Number(metrics.recall.toFixed(4)),
    },
  };
}

export async function getElectricityShock(): Promise<ElectricityShockResponse> {
  const shocks = await fetchGridShock();
  return {
    generated_at: new Date().toISOString(),
    regions: shocks.map((s) => ({
      region: s.region,
      current_price: s.current_price,
      price_30m: s.price_30m,
      shock_score: Number(s.shock_score.toFixed(4)),
      level: shockLevel(s.shock_score),
    })),
  };
}

export async function getMacroSummary(): Promise<MacroSummaryResponse> {
  const macroReq = {
    cpi_start: "2023-Q1",
    cpi_end: "2026-Q1",
    unemp_start: "2023-01",
    unemp_end: "2026-12",
  };
  const macroRes = await fetchMacroSeries(macroReq);
  if (!macroRes.ok) {
    return {
      source: "Mango API",
      cpi_latest: null,
      unemp_latest: null,
      error: macroRes.reason,
    };
  }

  const cpi = macroRes.series.cpi.at(-1) ?? null;
  const unemp = macroRes.series.unemp.at(-1) ?? null;
  return {
    source: "Mango API",
    cpi_latest: cpi
      ? { date: cpi.date, value: Number(cpi.value), change: Number(cpi.change) }
      : null,
    unemp_latest: unemp
      ? { date: unemp.date, value: Number(unemp.value), change: Number(unemp.change) }
      : null,
  };
}

export async function runPrediction(userId: string, body: unknown): Promise<PredictResponse> {
  if (!isObj(body)) throw badRequest("Body must be an object");
  const req = body as PredictRequest;
  if (typeof req.dataset_id !== "string" || req.dataset_id.length === 0) throw badRequest("dataset_id is required");
  if (typeof req.model_id !== "string" || req.model_id.length === 0) throw badRequest("model_id is required");

  const dataset = await readDataset(userId, req.dataset_id);
  if (!dataset) throw notFound("DATASET_NOT_FOUND");

  const stored = await readModel<any>(userId, req.model_id);
  if (!stored) throw notFound("MODEL_NOT_FOUND");

  const feature_list = stored.feature_list as string[];
  const bias = safeNumber(stored.bias, 0);
  const weights = Array.isArray(stored.weights) ? stored.weights.map((n: any) => safeNumber(n, 0)) : [];
  const scaler = stored.scaler ?? {};
  const mean = Array.isArray(scaler.mean) ? scaler.mean.map((n: any) => safeNumber(n, 0)) : [];
  const std = Array.isArray(scaler.std) ? scaler.std.map((n: any) => safeNumber(n, 1)) : [];

  if (feature_list.length === 0 || weights.length !== feature_list.length) throw badRequest("Stored model is invalid");
  if (mean.length !== feature_list.length || std.length !== feature_list.length) throw badRequest("Stored model scaler is invalid");

  const model = { bias, weights, spec: { feature_list, mean, std } };

  const macroEnabledByRequest = req.use_mango !== false;
  const macroEnabledByModel = stored.macro?.enabled !== false;
  const useMango = macroEnabledByRequest && macroEnabledByModel;
  const macroReq = useMango
    ? (stored.macro?.cpi_start && stored.macro?.cpi_end && stored.macro?.unemp_start && stored.macro?.unemp_end
      ? { cpi_start: stored.macro.cpi_start, cpi_end: stored.macro.cpi_end, unemp_start: stored.macro.unemp_start, unemp_end: stored.macro.unemp_end }
      : { cpi_start: "2023-Q1", cpi_end: "2026-Q1", unemp_start: "2023-01", unemp_end: "2026-03" })
    : null;
  const macroRes = macroReq ? await fetchMacroSeries(macroReq) : { ok: false as const, reason: "disabled" };
  const macroSeries = macroRes.ok ? macroRes.series : null;

  const bySym = groupDailyBars(dataset.events ?? []);
  const asOf = typeof req.as_of_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.as_of_date) ? req.as_of_date : null;

  let shocksByRegion: Record<string, number> | null = null;
  if (req.grid_overlay?.enabled) {
    try {
      const shocks = await fetchGridShock();
      shocksByRegion = Object.fromEntries(shocks.map((s) => [s.region, s.shock_score]));
    } catch {
      shocksByRegion = null;
    }
  }

  const exposed = Array.isArray(req.grid_overlay?.grid_exposed_symbols) ? req.grid_overlay!.grid_exposed_symbols : [];

  const predictions: PredictResponse["predictions"] = [];

  for (const [sym, series] of bySym.entries()) {
    if (series.length < 25) continue;
    let idx = series.length - 1;
    if (asOf) {
      const i = series.findIndex((b) => b.date === asOf);
      if (i >= 0) idx = i;
    }
    const macro = macroAtDate(macroSeries, series[idx]!.date);
    const x = computeFeatureVector(series, idx, macro);
    if (!x) continue;

    const pBase = predictProbability(model, x.map((v) => safeNumber(v, 0)));
    let pFinal = pBase;
    const drivers: string[] = [];

    // Feature contributions (top 3).
    const xStd = x.map((v, i) => (safeNumber(v, 0) - safeNumber(mean[i], 0)) / (safeNumber(std[i], 1) || 1));
    const contrib = xStd.map((v, i) => ({ name: feature_list[i] ?? `f${i}`, value: v, c: weights[i]! * v }));
    contrib.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
    for (const d of contrib.slice(0, 3)) {
      drivers.push(`${d.name} contribution=${d.c.toFixed(3)}`);
    }

    // Apply grid overlay only if symbol is declared exposed.
    const isExposed = exposed.some((s) => s === sym || sym.startsWith(`${s}.`) || s === sym.split(".")[0]);
    if (isExposed && shocksByRegion) {
      const shockScore = Object.values(shocksByRegion).reduce((m, v) => Math.max(m, v), 0);
      pFinal = applyShockOverlay(pFinal, shockScore);
      drivers.push(`grid_shock_overlay score=${shockScore.toFixed(3)} level=${shockLevel(shockScore)}`);
    }

    if (!useMango) drivers.push("macro_disabled");
    else if (!macroRes.ok) drivers.push("macro_unavailable");

    predictions.push({
      symbol: sym,
      p_spike_7d: Number(pFinal.toFixed(4)),
      risk_level: riskLevel(pFinal),
      drivers,
    });
  }

  // Prefer stable sort: highest risk first.
  predictions.sort((a, b) => b.p_spike_7d - a.p_spike_7d);

  const outDate = asOf ?? (() => {
    let latest = "";
    for (const s of bySym.values()) {
      const d = s[s.length - 1]?.date ?? "";
      if (d > latest) latest = d;
    }
    return latest || new Date().toISOString().slice(0, 10);
  })();

  return { as_of: outDate, predictions };
}
