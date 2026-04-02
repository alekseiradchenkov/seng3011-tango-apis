
// yahoo.service.ts

// Fetches daily OHLC (Open/High/Low/Close) stock data from Yahoo Finance's
// unofficial chart API and converts it into the ADAGE event format used
// throughout this project.

import { AdageEvent } from "../../../../shared/types/adage.type";


// Represents the raw JSON shape returned by Yahoo Finance's chart endpoint.
// Only the fields we actually use are typed here; the full response has more.
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


// Converts an ADAGE-format symbol (e.g. "AAPL.XNAS") to the bare ticker
// that Yahoo Finance expects (e.g. "AAPL").
// If the symbol has no dot, it is returned as-is.
function toYahooSymbol(symbol: string): string {
  // Existing API uses symbols like "AAPL.XNAS". Yahoo generally expects "AAPL".
  const trimmed = symbol.trim();
  const base = trimmed.split(".")[0];
  return base || trimmed;
}

// Safely converts a value to a finite number, returning null for
// non-finite values (NaN, Infinity) and non-numbers. (e.g no trading days)
function safeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

// Makes a raw HTTP request to Yahoo Finance's unofficial chart endpoint
// for a single ticker symbol over a specified date range.

// @param symbol  Bare Yahoo ticker (e.g. "AAPL", not "AAPL.XNAS").
// @param period1 Start of the date range (defaults to 1 year ago).
// @param period2 End of the date range (defaults to now).
// @returns The raw Yahoo chart JSON response.
// @throws Error if the HTTP response is not OK.
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
  // Build a map from the base Yahoo ticker (e.g. "AAPL") back to the full
  // original symbol (e.g. "AAPL.XNAS") so the output preserves the caller's
  // exchange suffix without hardcoding anything.
  const symbolMap = new Map<string, string>();
  for (const sym of params.symbols ?? []) {
    const base = toYahooSymbol(sym);
    if (base) symbolMap.set(base, sym.trim());
  }

  const tickers = Array.from(symbolMap.keys());
  if (tickers.length === 0) return [];

  // Parse date strings to Date objects. period2 uses end-of-day time to include
  // the full trading day at the upper bound of the requested range.
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
    // Restore the original ADAGE symbol with exchange suffix for the output.
    const originalSymbol = symbolMap.get(ticker) ?? ticker;

    // Yahoo returns parallel arrays: one value per index per trading day.
    const tsArr = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0];
    const opens = q?.open ?? [];
    const highs = q?.high ?? [];
    const lows = q?.low ?? [];
    const closes = q?.close ?? [];
    const vols = q?.volume ?? [];

    // Convert each trading day into an ADAGE event.
    for (let i = 0; i < tsArr.length; i += 1) {
      const ts = new Date(tsArr[i] * 1000);
      events.push({
        time_object: {
          // Store as "YYYY-MM-DD HH:MM:SS" (space-separated) to match ADAGE convention.
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

