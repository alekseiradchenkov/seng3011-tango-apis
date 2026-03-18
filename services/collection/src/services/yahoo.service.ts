import { AdageEvent } from "../../../../shared/types/adage.type";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string; code?: string };
  };
};

function toYahooSymbol(symbol: string): string {
  // Existing API uses symbols like "AAPL.XNAS". Yahoo generally expects "AAPL".
  const trimmed = symbol.trim();
  const base = trimmed.split(".")[0];
  return base || trimmed;
}

function safeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

async function fetchYahooChart(symbol: string, period1?: Date, period2?: Date) {
  const p1 = period1 ? Math.floor(period1.getTime() / 1000) : Math.floor(Date.now() / 1000) - 365 * 86400;
  const p2 = period2 ? Math.floor(period2.getTime() / 1000) : Math.floor(Date.now() / 1000);

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");
  url.searchParams.set("includeAdjustedClose", "true");
  url.searchParams.set("period1", String(p1));
  url.searchParams.set("period2", String(p2));

  const res = await fetch(url.toString(), {
    headers: {
      // Helps avoid some edge caching behaviors; safe even if ignored.
      "user-agent": "Mozilla/5.0 (compatible; seng3011-tango/1.0)",
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo chart error: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as YahooChartResponse;
}

export async function getYahooEod(params: {
  symbols: string[];
  date_from?: string;
  date_to?: string;
}): Promise<AdageEvent[]> {
  const symbols = (params.symbols ?? []).map(toYahooSymbol).filter(Boolean);
  if (symbols.length === 0) return [];

  const period1 = params.date_from ? new Date(`${params.date_from}T00:00:00Z`) : undefined;
  // make end exclusive-ish by using end of day
  const period2 = params.date_to ? new Date(`${params.date_to}T23:59:59Z`) : undefined;

  const events: AdageEvent[] = [];

  for (const s of symbols) {
    const chart = await fetchYahooChart(s, period1, period2);
    const result = chart.chart?.result?.[0];
    if (!result) {
      const desc = chart.chart?.error?.description ?? "No chart result";
      throw new Error(`Yahoo chart missing result: ${desc}`);
    }

    const tsArr = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0];
    const opens = q?.open ?? [];
    const highs = q?.high ?? [];
    const lows = q?.low ?? [];
    const closes = q?.close ?? [];
    const vols = q?.volume ?? [];

    for (let i = 0; i < tsArr.length; i += 1) {
      const ts = new Date(tsArr[i] * 1000);
      events.push({
        time_object: {
          timestamp: ts.toISOString().replace("T", " ").replace("Z", ""),
          timezone: "UTC",
          duration: 1,
          duration_unit: "day",
        },
        event_type: "stock_ohlc",
        attribute: {
          symbol: `${s}.XNAS`,
          open: safeNumber(opens[i]),
          high: safeNumber(highs[i]),
          low: safeNumber(lows[i]),
          close: safeNumber(closes[i]),
          volume: safeNumber(vols[i]),
          currency: "USD",
        },
      });
    }
  }

  return events;
}

