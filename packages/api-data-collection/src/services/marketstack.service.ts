import { AdageEvent } from "../../../../shared/types/adage.type";
import {
  MarketstackEodResponse,
  MarketstackEod,
} from "../../../../shared/types/marketstack.type";

const MARKETSTACK_API_BASE = "https://api.marketstack.com/v2";

export async function getEod(
  apiKey: string,
  symbols: string[],
  exchange?: string,
  date_from?: string,
  date_to?: string,
  sort?: string,
  limit = 1000,
  offset = 0,
): Promise<MarketstackEodResponse> {
  const url = new URL(`${MARKETSTACK_API_BASE}/eod`);
  url.searchParams.set("access_key", apiKey);
  url.searchParams.set("symbols", symbols.join(","));

  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (exchange) url.searchParams.set("exchange", exchange);
  if (date_from) url.searchParams.set("date_from", date_from);
  if (date_to) url.searchParams.set("date_to", date_to);
  if (sort) url.searchParams.set("sort", sort);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(
      `Marketstack API error: ${response.status} ${await response.text()}`,
    );
  }

  return response.json() as Promise<MarketstackEodResponse>;
}

export function extractMarketstackTimezone(date: string): string {
  const match = date.match(/([+-]\d{4})$/);

  if (!match) return "UTC";

  const offset = match[1];
  const hours = offset.slice(0, 3);
  const mins = offset.slice(3);

  return mins === "00" ? `GMT${hours}` : `GMT${hours}:${mins}`;
}

export async function getMarketstackEod(params: {
  symbols: string[];
  exchange?: string;
  date_from?: string;
  date_to?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<AdageEvent[]> {
  const apiKey = process.env.MARKETSTACK_API_KEY;
  if (!apiKey) {
    throw new Error("Marketstack API key not found.");
  }

  const firstPage = await getEod(
    apiKey,
    params.symbols,
    params.exchange,
    params.date_from,
    params.date_to,
    params.sort,
    params.limit,
    params.offset,
  );

  let data: MarketstackEod[] = firstPage.data;

  /* The API only returns maximum 1000 records per request. */
  const total = firstPage.pagination.total;
  let offset = firstPage.data.length;

  while (offset < total) {
    const page = await getEod(
      apiKey,
      params.symbols,
      params.exchange,
      params.date_from,
      params.date_to,
      params.sort,
      params.limit,
      (params.offset || 0) + offset,
    );

    if (page.data.length === 0) break;

    data = data.concat(page.data);
    offset += page.data.length;
  }

  return data.map(
    (eod): AdageEvent => ({
      time_object: {
        timestamp: new Date(eod.date)
          .toISOString()
          .replace("T", " ")
          .replace("Z", ""),
        timezone: extractMarketstackTimezone(eod.date),
        duration: 1,
        duration_unit: "day",
      },
      event_type: "stock_ohlc",
      attribute: {
        symbol: eod.symbol,
        name: eod.name,
        exchange: eod.exchange,
        exchange_code: eod.exchange_code,
        open: eod.open,
        high: eod.high,
        low: eod.low,
        close: eod.close,
        volume: eod.volume,
        adj_open: eod.adj_open,
        adj_high: eod.adj_high,
        adj_low: eod.adj_low,
        adj_close: eod.adj_close,
        adj_volume: eod.adj_volume,
        split_factor: eod.split_factor,
        dividend: eod.dividend,
        currency: eod.price_currency,
      },
    }),
  );
}
