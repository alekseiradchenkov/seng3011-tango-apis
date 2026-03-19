/**
 * Unit tests for yahoo.service.ts
 *
 * Tests the Yahoo Finance chart client in isolation by mocking the global fetch.
 * Covers URL construction, date defaults, error handling, safeNumber edge cases,
 * and Adage event mapping in getYahooEod.
 *
 * Run:      npx jest test/yahoo.test.ts
 * Coverage: npx jest test/yahoo.test.ts --coverage
 */

import { getYahooEod } from "../src/services/yahoo.service";

// Replaces the global fetch so no real HTTP requests are made during tests.
global.fetch = jest.fn();
const mockFetch = fetch as jest.Mock;

// Builds a minimal valid Yahoo Finance chart API response.
// Pass optional overrides to replace fields on the result object for edge-case tests.
const makeChartResponse = (overrides: Record<string, any> = {}) => ({
  chart: {
    result: [{
      timestamp: [1704153600], // 2024-01-02 00:00:00 UTC
      indicators: { quote: [{ open: [185.0], high: [187.5], low: [184.0], close: [186.5], volume: [50000000] }] },
      ...overrides,
    }],
    error: null,
  },
});

describe("yahoo.service", () => {
  beforeEach(() => jest.clearAllMocks());

  // getYahooEod
  // Fetches EOD stock data from Yahoo Finance and maps each data point to an Adage event.
  // Pass (empty)          = returns [] without any HTTP requests
  // Pass (suffix strip)   = exchange suffix is removed before calling the Yahoo URL
  // Pass (event mapping)  = OHLCV + symbol + currency fields map correctly to Adage shape
  // Pass (bare symbol)    = symbol with no dot is used as-is
  // Pass (timestamp)      = timestamp is "YYYY-MM-DD HH:MM:SS" not ISO
  // Pass (multi-symbol)   = one request per symbol; all events combined
  // Pass (date range)     = date_from/date_to map to correct period1/period2 in the URL
  // Pass (default dates)  = no dates → period2 ≈ now, period1 ≈ now − 365 days
  // Pass (null OHLCV)     = null array entries map to null in the event attribute
  // Pass (non-finite)     = Infinity and NaN map to null via safeNumber
  // Pass (empty ts array) = empty timestamp array produces zero events
  // Pass (no indicators)  = missing quote array produces null OHLCV fields
  // Fail (HTTP error)     = throws when the response status is not OK
  // Fail (null result)    = throws using the API error description (falls back to "No chart result")
  describe("getYahooEod — fetch and map Yahoo Finance EOD data to Adage events", () => {

    // Pass = returns [] and makes no HTTP requests when symbols is empty
    it("returns an empty array when no symbols are provided", async () => {
      const result = await getYahooEod({ symbols: [] });
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // Pass = ".XNAS" suffix is stripped; URL contains the bare ticker
    it("strips the exchange suffix before calling the Yahoo chart API", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeChartResponse() });
      await getYahooEod({ symbols: ["AAPL.XNAS"] });
      const url: string = mockFetch.mock.calls[0][0];
      expect(url).toContain("/chart/AAPL");
      expect(url).not.toContain("XNAS");
    });

    // Pass = all Adage fields (event_type, symbol, OHLCV, currency) are populated correctly
    it("maps the chart response to correctly structured Adage events", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeChartResponse() });
      const result = await getYahooEod({ symbols: ["AAPL.XNAS"] });
      expect(result).toHaveLength(1);
      expect(result[0].event_type).toBe("stock_ohlc");
      expect(result[0].attribute.symbol).toBe("AAPL.XNAS");
      expect(result[0].attribute.open).toBe(185.0);
      expect(result[0].attribute.currency).toBe("USD");
    });

    // Pass = a symbol with no dot is used as-is in both the URL and the output attribute
    it("uses the bare symbol as-is when no dot suffix is present", async () => {
      // Covers toYahooSymbol (no dot → split('.')[0] === original) and
      // the symbolMap.get(ticker) ?? ticker fallback.
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeChartResponse() });
      const result = await getYahooEod({ symbols: ["AAPL"] });
      expect(result[0].attribute.symbol).toBe("AAPL");
    });

    // Pass = timestamp is "YYYY-MM-DD HH:MM:SS[.mmm]" (no T or Z)
    it("formats the event timestamp as a space-separated UTC string", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeChartResponse() });
      const result = await getYahooEod({ symbols: ["AAPL"] });
      expect(result[0].time_object.timestamp as string).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/,
      );
    });

    // Pass = one fetch per symbol; all events are returned in one combined array
    it("fetches each symbol separately and combines all events", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => makeChartResponse() })
        .mockResolvedValueOnce({ ok: true, json: async () => makeChartResponse() });
      const result = await getYahooEod({ symbols: ["AAPL.XNAS", "MSFT.XNAS"] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    // Pass = date_from → period1 and date_to → period2 as Unix seconds in the URL
    it("converts date_from and date_to to period1 and period2 in the URL", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeChartResponse() });
      await getYahooEod({ symbols: ["AAPL"], date_from: "2024-01-01", date_to: "2024-01-31" });
      const url: string = mockFetch.mock.calls[0][0];
      expect(url).toContain("period1=1704067200"); // 2024-01-01T00:00:00Z
      expect(url).toContain("period2=1706745599"); // 2024-01-31T23:59:59Z
    });

    // Pass = when no dates are given, period2 ≈ now and period1 ≈ now − 365 days
    it("defaults to a 1-year window when no dates are provided", async () => {
      // Covers the else branches in fetchYahooChart for both period1 and period2.
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeChartResponse() });
      const before = Math.floor(Date.now() / 1000);
      await getYahooEod({ symbols: ["AAPL"] });
      const after = Math.floor(Date.now() / 1000);
      const url: string = mockFetch.mock.calls[0][0];
      const p2 = Number(url.match(/period2=(\d+)/)![1]);
      const p1 = Number(url.match(/period1=(\d+)/)![1]);
      expect(p2).toBeGreaterThanOrEqual(before);
      expect(p2).toBeLessThanOrEqual(after);
      expect(Math.abs(p1 - (p2 - 365 * 86400))).toBeLessThanOrEqual(5);
    });

    // Pass = null array entries → null in the event attribute (safeNumber(null) → null)
    it("maps null OHLCV entries to null in the event attribute", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [{ timestamp: [1704153600], indicators: { quote: [{ open: [null], high: [null], low: [null], close: [null], volume: [null] }] } }],
            error: null,
          },
        }),
      });
      const result = await getYahooEod({ symbols: ["AAPL"] });
      expect(result[0].attribute.open).toBeNull();
      expect(result[0].attribute.close).toBeNull();
    });

    // Pass = Infinity and NaN → null (safeNumber: isFinite check)
    it("maps non-finite numbers (Infinity / NaN) to null", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [{ timestamp: [1704153600], indicators: { quote: [{ open: [Infinity], high: [NaN], low: [-Infinity], close: [NaN], volume: [Infinity] }] } }],
            error: null,
          },
        }),
      });
      const result = await getYahooEod({ symbols: ["AAPL"] });
      expect(result[0].attribute.open).toBeNull();
      expect(result[0].attribute.high).toBeNull();
    });

    // Pass = empty timestamp array → for-loop body never runs → zero events returned
    it("returns zero events when the timestamp array is empty", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: { result: [{ timestamp: [], indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] } }], error: null },
        }),
      });
      const result = await getYahooEod({ symbols: ["AAPL"] });
      expect(result).toHaveLength(0);
    });

    // Pass = absent indicators.quote → optional chaining returns undefined → OHLCV fields are null
    it("produces null OHLCV fields when the indicators/quote array is missing", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: { result: [{ timestamp: [1704153600], indicators: {} }], error: null },
        }),
      });
      const result = await getYahooEod({ symbols: ["AAPL"] });
      expect(result).toHaveLength(1);
      expect(result[0].attribute.open).toBeNull();
    });

    // Fail = throws when the HTTP response status is not 2xx
    it("throws when the HTTP response is not OK", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "Not Found" });
      await expect(getYahooEod({ symbols: ["INVALID"] })).rejects.toThrow("Yahoo chart error: 404");
    });

    // Fail = throws using the API error description; falls back to "No chart result" when absent
    it("throws with the API error description when the chart result is null or missing", async () => {
      // With a description
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ chart: { result: [null], error: { description: "Invalid ticker" } } }),
      });
      await expect(getYahooEod({ symbols: ["BAD"] })).rejects.toThrow("Invalid ticker");

      // Without a description → fallback message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ chart: { result: [null], error: null } }),
      });
      await expect(getYahooEod({ symbols: ["AAPL"] })).rejects.toThrow("No chart result");
    });
  });
});