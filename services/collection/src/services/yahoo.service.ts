/**
 * Yahoo Finance chart client: fetches daily OHLC and maps rows to ADAGE `stock_ohlc` events.
 */

import { AdageEvent } from "../../../../shared/types/adage.type";

/**
 * Subset of Yahoo chart API JSON used by this service.
 */
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

/**
 * Converts a dotted ADAGE symbol (e.g. `AAPL.XNAS`) to Yahoo’s bare ticker (`AAPL`).
 */
function toYahooSymbol(symbol: string): string {
  const trimmed = symbol.trim();
  const base = trimmed.split(".")[0];
  return base || trimmed;
}

/**
 * @returns Finite number or `null`.
 */
function safeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/**
 * Fetches Yahoo chart JSON for a ticker and date range.
 *
 * @param symbol - Bare Yahoo ticker (e.g. `AAPL`).
 * @param period1 - Range start (default ~1 year ago).
 * @param period2 - Range end (default now).
 * @throws Error if HTTP status is not OK.
 */
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
      "user-agent": "Mozilla/5.0 (compatible; seng3011-tango/1.0)",
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo chart error: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as YahooChartResponse;
}

/**
 * Fetches end-of-day OHLC for each qualified symbol and returns ADAGE `stock_ohlc` events.
 *
 * @param params.symbols - Dotted symbols (e.g. `AAPL.XNAS`); mapped to Yahoo tickers internally.
 * @param params.date_from - Optional ISO date start (`YYYY-MM-DD`).
 * @param params.date_to - Optional ISO date end.
 */
export async function getYahooEod(params: {
  symbols: string[];
  date_from?: string;
  date_to?: string;
}): Promise<AdageEvent[]> {
  const symbolMap = new Map<string, string>();
  for (const sym of params.symbols ?? []) {
    const base = toYahooSymbol(sym);
    if (base) symbolMap.set(base, sym.trim());
  }

  const tickers = Array.from(symbolMap.keys());
  if (tickers.length === 0) return [];

  const period1 = params.date_from ? new Date(`${params.date_from}T00:00:00Z`) : undefined;
  const period2 = params.date_to ? new Date(`${params.date_to}T23:59:59Z`) : undefined;

  const events: AdageEvent[] = [];

  for (const ticker of tickers) {
    const chart = await fetchYahooChart(ticker, period1, period2);
    const result = chart.chart?.result?.[0];
    if (!result) {
      const desc = chart.chart?.error?.description ?? "No chart result";
      throw new Error(`Yahoo chart missing result: ${desc}`);
    }
    const originalSymbol = symbolMap.get(ticker) ?? ticker;

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
          symbol: originalSymbol,
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
