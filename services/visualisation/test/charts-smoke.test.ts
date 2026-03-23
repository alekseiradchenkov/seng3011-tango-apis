import express from "express";
import request from "supertest";

jest.mock("../../../shared/auth/user.auth", () => ({
  checkAuth: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "test-user";
    next();
  },
}));

function s3DatasetResponse(dataset_id: string) {
  // `datasets/${userId}/${dataset_id}.json` → we want dataset_id only.
  switch (dataset_id) {
    case "ds_ok":
      return {
        events: [
          {
            time_object: { timestamp: "2024-01-02 00:00:00.000" },
            event_type: "stock_ohlc",
            attribute: { symbol: "AAPL.XNAS", open: 180, high: 188, low: 179, close: 186.7, volume: 1000 },
          },
          {
            time_object: { timestamp: "2024-01-03 00:00:00.000" },
            event_type: "other",
            attribute: { symbol: "MSFT.XNAS", open: 195, high: 205, low: 190, close: 200.1, volume: 900 },
          },
        ],
      };
    case "ds_missing":
      // handled by mock below (throw)
      return null;
    case "ds_filtered":
      return {
        events: [
          {
            time_object: { timestamp: "2024-01-10 00:00:00.000" },
            event_type: "stock_ohlc",
            attribute: { symbol: "AAPL.XNAS", open: 10, high: 12, low: 9, close: 11, volume: 111 },
          },
          {
            time_object: { timestamp: "2024-01-20 00:00:00.000" },
            event_type: "stock_ohlc",
            attribute: { symbol: "AAPL.XNAS", open: 14, high: 16, low: 13, close: 15, volume: 115 },
          },
          {
            time_object: { timestamp: "2024-01-25 00:00:00.000" },
            event_type: "stock_ohlc",
            attribute: { symbol: "MSFT.XNAS", open: 98, high: 100, low: 95, close: 99, volume: 999 },
          },
          {
            time_object: { timestamp: "2024-01-30 00:00:00.000" },
            event_type: "other",
            attribute: { symbol: "AAPL.XNAS", open: 32, high: 34, low: 30, close: 33, volume: 333 },
          },
          {
            time_object: { timestamp: "2024-02-01 00:00:00.000" },
            event_type: "stock_ohlc",
            attribute: { symbol: "AAPL.XNAS", open: 39, high: 41, low: 38, close: 40, volume: 400 },
          },
        ],
      };
    case "ds_noohlc":
      return {
        events: [
          {
            time_object: { timestamp: "2024-01-02 00:00:00.000" },
            event_type: "stock_ohlc",
            // close is a string -> invalid OHLC point for candlestick renderer.
            attribute: { symbol: "AAPL.XNAS", open: 10, high: 12, low: 9, close: "bad", volume: 1000 },
          },
        ],
      };
    case "ds_bad_event":
      return {
        events: [
          {
            // missing timestamp will throw in router when building labels
            time_object: {},
            event_type: "stock_ohlc",
            attribute: { symbol: "AAPL.XNAS", close: 1, volume: 1 },
          },
        ],
      };
    default:
      return null;
  }
}

// Override S3Client mock with dataset-dependent responses.
jest.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockImplementation(async (cmd: any) => {
        const key = (cmd?.input?.Key as string | undefined) ?? (cmd?.Key as string | undefined);
        const last = key ? key.split("/").pop() : undefined;
        const dataset_id = last ? last.replace(/\.json$/, "") : undefined;
        const resp = dataset_id ? s3DatasetResponse(dataset_id) : null;
        if (!resp) {
          const err: any = new Error("NoSuchKey");
          err.name = "NoSuchKey";
          throw err;
        }
        return { Body: { transformToString: async () => JSON.stringify(resp) } };
      }),
    })),
    GetObjectCommand: class GetObjectCommand {
      input: any;
      constructor(i: any) {
        this.input = i;
        Object.assign(this, i);
      }
    },
  };
});

describe("visualisation charts smoke", () => {
  beforeEach(() => {
    process.env.EVENTS_BUCKET = "events-bucket";
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.LOCALSTACK_HOSTNAME;
  });

  it("returns 400 when dataset_id is missing", async () => {
    const router = (await import("../src/routes/v1")).default;
    const app = express();
    app.use("/", router);
    const res = await request(app).get("/charts");
    expect(res.status).toBe(400);
  });

  it("returns PNG when dataset_id is provided", async () => {
    const router = (await import("../src/routes/v1")).default;
    const app = express();
    app.use("/", router);
    const res = await request(app).get("/charts?dataset_id=ds_ok");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("returns 404 when dataset_id is not found (S3 NoSuchKey)", async () => {
    const router = (await import("../src/routes/v1")).default;
    const app = express();
    app.use("/", router);
    const res = await request(app).get("/charts?dataset_id=ds_missing");
    expect(res.status).toBe(404);
  });

  it("applies start/end, companies, and x_axis=symbol filters", async () => {
    const router = (await import("../src/routes/v1")).default;
    const app = express();
    app.use("/", router);
    const res = await request(app).get(
      "/charts?dataset_id=ds_filtered&companies=AAPL&x_axis=symbol&start_date=2024-01-05&end_date=2024-01-31&title=ok",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("returns 400 when no valid OHLC points exist", async () => {
    const router = (await import("../src/routes/v1")).default;
    const app = express();
    app.use("/", router);
    const res = await request(app).get(
      "/charts?dataset_id=ds_noohlc",
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when an event is malformed (labels throw)", async () => {
    const router = (await import("../src/routes/v1")).default;
    const app = express();
    app.use("/", router);
    const res = await request(app).get("/charts?dataset_id=ds_bad_event");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL");
  });
});
