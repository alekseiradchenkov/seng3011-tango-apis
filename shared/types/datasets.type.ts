export type DatasetCreateInput = {
  name?: string;
  description?: string;
};

/** Body for POST .../events/fetch.
 *  Symbols must be bare tickers (no dots). The exchange is required and is
 *  combined with each symbol to form the fully-qualified ADAGE identifier,
 *  e.g. "AAPL" + "XNAS" → "AAPL.XNAS". */
export type FetchEventsInput = {
  symbols: string[];
  exchange: string;
  date_from?: string;
  date_to?: string;
};

/** Body for DELETE .../events/remove — filter which stored events to remove. */
export type RemoveEventsFilter = {
  symbols?: string[];
  date_from?: string;
  date_to?: string;
};

export type DatasetPagination = {
  limit?: number;
  offset?: number;
};
