/**
 * Misc tests for `visualisation/src/server.ts`.
 *
 * These ensure server-level middleware coverage (404 + error handler) in
 * addition to the /charts route tests.
 */

import request from "supertest";

jest.mock("../../../shared/auth/user.auth", () => ({
  checkAuth: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "test-user";
    next();
  },
}));

jest.mock("chartjs-node-canvas", () => ({
  ChartJSNodeCanvas: jest.fn().mockImplementation(() => ({
    renderToBuffer: async () => Buffer.from("ok"),
  })),
}));

jest.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand {
    input: any;
    constructor(i: any) {
      this.input = i;
      Object.assign(this, i);
    }
  }

  function datasetIdFromKey(key: string) {
    const last = key.split("/").pop() ?? "";
    return last.replace(/\.json$/, "");
  }

  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(async (cmd: any) => {
        const key = cmd?.input?.Key as string | undefined;
        const dataset_id = key ? datasetIdFromKey(key) : undefined;

        if (dataset_id === "ds_bad_event") {
          return {
            Body: {
              transformToString: async () =>
                JSON.stringify({
                  events: [
                    {
                      time_object: {},
                      event_type: "stock_ohlc",
                      attribute: { symbol: "AAPL.XNAS", close: 1, volume: 1 },
                    },
                  ],
                }),
            },
          };
        }

        if (dataset_id === "ds_ok") {
          return {
            Body: {
              transformToString: async () =>
                JSON.stringify({
                  events: [
                    {
                      time_object: { timestamp: "2024-01-02 00:00:00.000" },
                      event_type: "stock_ohlc",
                      attribute: { symbol: "AAPL.XNAS", close: 10, volume: 100 },
                    },
                  ],
                }),
            },
          };
        }

        const err: any = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }),
    })),
    GetObjectCommand,
  };
});

import { app } from "../src/server";

describe("visualisation server middleware", () => {
  beforeEach(() => {
    process.env.EVENTS_BUCKET = "events-bucket";
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.LOCALSTACK_HOSTNAME;
  });

  it("returns 404 for unknown path", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
  });

  it("returns PNG for /charts on the real server app", async () => {
    const res = await request(app).get("/charts?dataset_id=ds_ok");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("returns 500 JSON on malformed event", async () => {
    const res = await request(app).get("/charts?dataset_id=ds_bad_event");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL");
  });
});

