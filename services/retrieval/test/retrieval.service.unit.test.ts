/**
 * Unit tests for retrieval.service — pure helpers and AWS-backed flows with mocked SDKs.
 *
 * Run: npx jest test/retrieval.service.unit.test.ts --coverage
 */

const sendMock = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: sendMock })),
  },
  QueryCommand: class QueryCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  GetCommand: class GetCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockImplementation(async (cmd: { constructor: { name: string } }) => {
      if (cmd.constructor.name === "GetObjectCommand") {
        return {
          Body: {
            transformToString: async () =>
              JSON.stringify({
                events: [
                  {
                    time_object: { timestamp: "2024-01-15 00:00:00.000" },
                    event_type: "stock_ohlc",
                    attribute: { symbol: "AAPL.XNAS", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
                  },
                  {
                    time_object: { timestamp: "2024-01-16 00:00:00.000" },
                    event_type: "stock_ohlc",
                    attribute: { symbol: "AAPL.XNAS", close: 2 },
                  },
                  {
                    time_object: { timestamp: "2024-01-17 00:00:00.000" },
                    event_type: "other",
                    attribute: { symbol: "MSFT.XNAS", name: "Microsoft" },
                  },
                ],
              }),
          },
        };
      }
      throw new Error("unexpected S3 command");
    }),
  })),
  GetObjectCommand: class GetObjectCommand {},
}));

import {
  csv,
  datasetS3Key,
  filterEvents,
  parseDateQuery,
  parseEventTime,
  sortAndLimit,
  getDatasets,
  getDataset,
  getEvents,
  getEventStats,
  exportEventsAsCsv,
} from "../src/services/retrieval.service";

describe("retrieval.service — pure helpers", () => {
  it("datasetS3Key builds path", () => {
    expect(datasetS3Key("u1", "ds1")).toBe("datasets/u1/ds1.json");
  });

  it("parseEventTime handles space and ISO timestamps", () => {
    expect(parseEventTime({ time_object: { timestamp: "2024-01-01 12:00:00.000" } } as any)).toBe(
      Date.parse("2024-01-01T12:00:00.000Z"),
    );
    expect(parseEventTime({ time_object: { timestamp: "2024-01-01T12:00:00.000Z" } } as any)).toBe(
      Date.parse("2024-01-01T12:00:00.000Z"),
    );
    expect(Number.isNaN(parseEventTime({ time_object: {} } as any))).toBe(true);
  });

  it("parseDateQuery", () => {
    expect(parseDateQuery("2024-06-01")).toBe(Date.parse("2024-06-01T00:00:00Z"));
    expect(parseDateQuery("")).toBeNull();
    expect(parseDateQuery(1)).toBeNull();
  });

  it("csv escapes quotes and commas", () => {
    expect(csv(["a", 1, null])).toBe("a,1,");
    expect(csv(['say "hi"', "a,b"])).toBe('"say ""hi""","a,b"');
    expect(csv(["line\nbreak"])).toBe('"line\nbreak"');
  });

  it("filterEvents applies date, event_type, companies", () => {
    const events = [
      {
        time_object: { timestamp: "2024-01-10 00:00:00.000" },
        event_type: "stock_ohlc",
        attribute: { symbol: "AAPL.XNAS", name: "Apple" },
      },
      {
        time_object: { timestamp: "2024-02-10 00:00:00.000" },
        event_type: "stock_ohlc",
        attribute: { symbol: "MSFT.XNAS" },
      },
    ] as any[];

    const byStart = filterEvents(events, { start_date: "2024-02-01" });
    expect(byStart).toHaveLength(1);

    const byType = filterEvents(events, { event_type: "stock_ohlc" });
    expect(byType).toHaveLength(2);

    const byCompanies = filterEvents(events, { companies: "AAPL" });
    expect(byCompanies.length).toBeGreaterThanOrEqual(1);

    const arrCompanies = filterEvents(events, { companies: ["MSFT"] });
    expect(arrCompanies.length).toBeGreaterThanOrEqual(1);
  });

  it("sortAndLimit respects order, limit, non-time sort passthrough", () => {
    const ev = [
      { time_object: { timestamp: "2024-01-02" }, event_type: "a" },
      { time_object: { timestamp: "2024-01-01" }, event_type: "b" },
    ] as any[];
    const asc = sortAndLimit(ev, { order: "ASC", limit: "10" });
    expect(asc[0].time_object.timestamp).toContain("2024-01-01");
    const desc = sortAndLimit(ev, { order: "DESC", limit: "1" });
    expect(desc).toHaveLength(1);
    const otherSort = sortAndLimit(ev, { sort: "other", limit: "invalid" });
    expect(otherSort.length).toBeGreaterThan(0);
  });
});

describe("retrieval.service — AWS-backed functions", () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.EVENT_INDEX_TABLE = "tbl";
    process.env.EVENTS_BUCKET = "bucket";
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.LOCALSTACK_HOSTNAME;
  });

  it("getDatasets returns mapped items", async () => {
    sendMock.mockResolvedValueOnce({
      Items: [
        {
          dataset_id: "d1",
          name: "N",
          description: "D",
          data_source: "YahooFinance",
          dataset_type: "daily_stock_ohlc_data",
          time_object: { timestamp: "t" },
        },
      ],
    });
    const out = await getDatasets("user-1");
    expect(out).toHaveLength(1);
    expect(out[0].dataset_id).toBe("d1");
  });

  it("getDataset returns null when meta missing", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });
    const out = await getDataset("u", "missing");
    expect(out).toBeNull();
  });

  it("getDataset returns metadata fields", async () => {
    sendMock.mockResolvedValueOnce({
      Item: {
        dataset_id: "d1",
        name: "N",
        data_source: "YahooFinance",
        dataset_type: "daily_stock_ohlc_data",
        time_object: { timestamp: "t" },
      },
    });
    const out = await getDataset("u", "d1");
    expect(out?.dataset_id).toBe("d1");
  });

  it("getEvents returns 404 path when no meta", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });
    const out = await getEvents("u", "d1", {});
    expect(out).toBeNull();
  });

  it("getEvents returns filtered payload", async () => {
    sendMock.mockResolvedValueOnce({
      Item: {
        dataset_id: "d1",
        name: "N",
        data_source: "YahooFinance",
        dataset_type: "daily_stock_ohlc_data",
        time_object: { timestamp: "t" },
      },
    });
    const out = await getEvents("u", "d1", { event_type: "stock_ohlc" });
    expect(out?.retrieved).toBeGreaterThan(0);
    const evs = out?.dataset.events as unknown[] | undefined;
    expect(Array.isArray(evs) && evs.length).toBeGreaterThan(0);
  });

  it("getEventStats aggregates types", async () => {
    sendMock.mockResolvedValueOnce({
      Item: {
        dataset_id: "d1",
        name: "N",
        data_source: "YahooFinance",
        dataset_type: "daily_stock_ohlc_data",
        time_object: { timestamp: "t" },
      },
    });
    const out = await getEventStats("u", "d1", {});
    expect(out?.total_events).toBeGreaterThan(0);
    expect(out?.event_type_counts).toBeDefined();
  });

  it("exportEventsAsCsv returns null without meta", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });
    const out = await exportEventsAsCsv("u", "d1", {});
    expect(out).toBeNull();
  });

  it("exportEventsAsCsv returns header and rows", async () => {
    sendMock.mockResolvedValueOnce({
      Item: {
        dataset_id: "d1",
        name: "N",
        data_source: "YahooFinance",
        dataset_type: "daily_stock_ohlc_data",
        time_object: { timestamp: "t" },
      },
    });
    const out = await exportEventsAsCsv("u", "d1", {});
    expect(out).toContain("symbol,open,high,low,close,volume,timestamp");
    expect(out).toContain("AAPL.XNAS");
  });
});
