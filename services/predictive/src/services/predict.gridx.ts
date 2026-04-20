function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

async function postJson(url: string, body: any, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getText(url: string, timeoutMs: number): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function parseSseDataArray(body: string): any[] | null {
  // Gradio returns server-sent events like:
  // event: complete\n
  // data: [ ...json... ]\n\n
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const raw = line.slice(6).trim();
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export type RegionShock = {
  region: string;
  current_price: number;
  price_5m: number;
  price_15m: number;
  price_30m: number;
  shock_score: number;
};

export function shockLevel(score: number): "LOW" | "ELEVATED" | "HIGH" | "CRITICAL" {
  if (score < 0.02) return "LOW";
  if (score < 0.05) return "ELEVATED";
  if (score < 0.1) return "HIGH";
  return "CRITICAL";
}

export async function fetchGridShock(): Promise<RegionShock[]> {
  const base = requireEnv("GRIDX_HF_BASE_URL").replace(/\/+$/, "");
  const init = await postJson(`${base}/call/refresh_dashboard`, { data: [] }, 15_000);
  const eventId = init?.event_id;
  if (typeof eventId !== "string" || eventId.length === 0) throw new Error("Missing event_id from GridX model");

  // Poll a few times; Gradio often completes quickly.
  for (let attempt = 0; attempt < 10; attempt++) {
    const txt = await getText(`${base}/call/refresh_dashboard/${encodeURIComponent(eventId)}`, 15_000);
    const arr = parseSseDataArray(txt);
    if (!arr) continue;

    const table = arr.find((x) => x && typeof x === "object" && Array.isArray((x as any).headers) && Array.isArray((x as any).data));
    if (!table) continue;

    const headers = (table as any).headers as string[];
    const rows = (table as any).data as any[][];

    const idxRegion = headers.indexOf("Region");
    const idxCur = headers.indexOf("Current Price");
    const idx5 = headers.indexOf("Price In 5m");
    const idx15 = headers.indexOf("Price In 15m");
    const idx30 = headers.indexOf("Price In 30m");
    if ([idxRegion, idxCur, idx5, idx15, idx30].some((i) => i < 0)) continue;

    const out: RegionShock[] = [];
    for (const r of rows) {
      const region = String(r[idxRegion] ?? "");
      const cur = Number(r[idxCur]);
      const p5 = Number(r[idx5]);
      const p15 = Number(r[idx15]);
      const p30 = Number(r[idx30]);
      if (!region || !Number.isFinite(cur) || cur === 0) continue;
      const shock_score = Math.max(
        Math.abs((p5 - cur) / cur),
        Math.abs((p15 - cur) / cur),
        Math.abs((p30 - cur) / cur),
      );
      out.push({ region, current_price: cur, price_5m: p5, price_15m: p15, price_30m: p30, shock_score });
    }
    if (out.length > 0) return out;
  }

  throw new Error("GridX model did not return results in time");
}

