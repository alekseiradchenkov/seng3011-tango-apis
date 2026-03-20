/**
 * HTTP tests for retrieval v1 routes with mocked service layer.
 */

jest.mock("../../../shared/auth/user.auth", () => ({
  checkAuth: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "test-user";
    next();
  },
}));

const getDatasets = jest.fn();
const getDataset = jest.fn();
const getEvents = jest.fn();
const getEventStats = jest.fn();
const exportEventsAsCsv = jest.fn();

jest.mock("../src/services/retrieval.service", () => ({
  getDatasets: (...a: unknown[]) => getDatasets(...a),
  getDataset: (...a: unknown[]) => getDataset(...a),
  getEvents: (...a: unknown[]) => getEvents(...a),
  getEventStats: (...a: unknown[]) => getEventStats(...a),
  exportEventsAsCsv: (...a: unknown[]) => exportEventsAsCsv(...a),
}));

import request from "supertest";
import express from "express";
import v1 from "../src/routes/v1.route";
import routesIndex from "../src/routes";

function mount() {
  const app = express();
  app.use("/", v1);
  return app;
}

describe("retrieval v1 routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /datasets returns list", async () => {
    getDatasets.mockResolvedValue([{ dataset_id: "d1" }]);
    const res = await request(mount()).get("/datasets");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ dataset_id: "d1" }]);
  });

  it("GET /datasets/:id returns 404 when missing", async () => {
    getDataset.mockResolvedValue(null);
    const res = await request(mount()).get("/datasets/x");
    expect(res.status).toBe(404);
  });

  it("GET /datasets/:id returns body", async () => {
    getDataset.mockResolvedValue({ dataset_id: "x" });
    const res = await request(mount()).get("/datasets/x");
    expect(res.status).toBe(200);
    expect(res.body.dataset_id).toBe("x");
  });

  it("GET /datasets/:id/events returns 404", async () => {
    getEvents.mockResolvedValue(null);
    const res = await request(mount()).get("/datasets/x/events");
    expect(res.status).toBe(404);
  });

  it("GET /datasets/:id/events returns data", async () => {
    getEvents.mockResolvedValue({ retrieved: 1, dataset: {} });
    const res = await request(mount()).get("/datasets/x/events?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.retrieved).toBe(1);
  });

  it("GET /datasets/:id/events/stats", async () => {
    getEventStats.mockResolvedValue(null);
    let res = await request(mount()).get("/datasets/x/events/stats");
    expect(res.status).toBe(404);

    getEventStats.mockResolvedValue({ total_events: 2, event_type_counts: { a: 2 } });
    res = await request(mount()).get("/datasets/x/events/stats");
    expect(res.status).toBe(200);
    expect(res.body.total_events).toBe(2);
  });

  it("GET /datasets/:id/export returns csv or 404", async () => {
    exportEventsAsCsv.mockResolvedValue(null);
    let res = await request(mount()).get("/datasets/x/export");
    expect(res.status).toBe(404);

    exportEventsAsCsv.mockResolvedValue("a,b\n1,2\n");
    res = await request(mount()).get("/datasets/x/export");
    expect(res.status).toBe(200);
    expect(res.text).toContain("a,b");
    expect(res.headers["content-type"]).toMatch(/csv/);
  });

  it("route error handler returns 500", async () => {
    getDatasets.mockRejectedValue(new Error("ddb down"));
    const res = await request(mount()).get("/datasets");
    expect(res.status).toBe(500);
  });

  it("routes/index.ts mounts the same v1 router", async () => {
    getDatasets.mockResolvedValue([]);
    const app = express();
    app.use("/", routesIndex);
    const res = await request(app).get("/datasets");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
