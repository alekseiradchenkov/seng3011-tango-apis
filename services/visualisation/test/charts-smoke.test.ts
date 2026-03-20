import express from "express";
import request from "supertest";

jest.mock("../../../shared/auth/user.auth", () => ({
  checkAuth: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "test-user";
    next();
  },
}));

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            events: [
              {
                time_object: { timestamp: "2026-02-03 14:30:00.000" },
                event_type: "stock_ohlc",
                attribute: { symbol: "AAPL.XNAS", close: 186.7, volume: 1000 },
              },
            ],
          }),
      },
    }),
  })),
  GetObjectCommand: class GetObjectCommand {},
}));

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
    const res = await request(app).get("/charts?dataset_id=ds_1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });
});
