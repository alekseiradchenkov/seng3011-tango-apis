/**
 * Collection v1 HTTP routes with mocked datasets.service.
 */

jest.mock("../../../shared/auth/user.auth", () => ({
  checkAuth: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "test-user";
    next();
  },
}));

const createDataset = jest.fn();
const updateDataset = jest.fn();
const deleteDataset = jest.fn();
const fetchEvents = jest.fn();
const removeEvents = jest.fn();

jest.mock("../src/services/datasets.service", () => ({
  createDataset: (...a: unknown[]) => createDataset(...a),
  updateDataset: (...a: unknown[]) => updateDataset(...a),
  deleteDataset: (...a: unknown[]) => deleteDataset(...a),
  fetchEvents: (...a: unknown[]) => fetchEvents(...a),
  removeEvents: (...a: unknown[]) => removeEvents(...a),
}));

import request from "supertest";
import express from "express";
import v1 from "../src/routes/v1.route";
import routesIndex from "../src/routes";

function mount() {
  const app = express();
  app.use(express.json());
  app.use("/", v1);
  return app;
}

describe("collection v1 routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /datasets 400 without name", async () => {
    const res = await request(mount()).post("/datasets").send({});
    expect(res.status).toBe(400);
  });

  it("POST /datasets 201", async () => {
    createDataset.mockResolvedValue({ dataset_id: "d1" });
    const res = await request(mount())
      .post("/datasets")
      .send({ name: "N", description: "D" });
    expect(res.status).toBe(201);
  });

  it("PUT /datasets/:id 404", async () => {
    updateDataset.mockResolvedValue(null);
    const res = await request(mount()).put("/datasets/x").send({ name: "n" });
    expect(res.status).toBe(404);
  });

  it("PUT /datasets/:id 200", async () => {
    updateDataset.mockResolvedValue({ dataset_id: "x" });
    const res = await request(mount()).put("/datasets/x").send({ name: "n" });
    expect(res.status).toBe(200);
  });

  it("DELETE /datasets/:id 404", async () => {
    deleteDataset.mockResolvedValue(0);
    const res = await request(mount()).delete("/datasets/x");
    expect(res.status).toBe(404);
  });

  it("DELETE /datasets/:id 200", async () => {
    deleteDataset.mockResolvedValue(1);
    const res = await request(mount()).delete("/datasets/x");
    expect(res.status).toBe(200);
  });

  it("PUT /datasets/:id/events validation", async () => {
    let res = await request(mount()).put("/datasets/x/events").send({ symbols: [] });
    expect(res.status).toBe(400);
    res = await request(mount()).put("/datasets/x/events").send({ symbols: ["AAPL"], exchange: "" });
    expect(res.status).toBe(400);
    res = await request(mount()).put("/datasets/x/events").send({ symbols: ["AAPL.X"], exchange: "X" });
    expect(res.status).toBe(400);
  });

  it("PUT /datasets/:id/events 404 and 200", async () => {
    fetchEvents.mockResolvedValue(null);
    let res = await request(mount())
      .put("/datasets/x/events")
      .send({ symbols: ["AAPL"], exchange: "XNAS" });
    expect(res.status).toBe(404);

    fetchEvents.mockResolvedValue({ count: 1 });
    res = await request(mount())
      .put("/datasets/x/events")
      .send({ symbols: ["AAPL"], exchange: "XNAS", date_from: "2024-01-01" });
    expect(res.status).toBe(200);
  });

  it("DELETE /datasets/:id/events 404 and 200", async () => {
    removeEvents.mockResolvedValue(null);
    let res = await request(mount()).delete("/datasets/x/events").send({});
    expect(res.status).toBe(404);

    removeEvents.mockResolvedValue({ count: 2 });
    res = await request(mount()).delete("/datasets/x/events").send({ symbols: ["AAPL"] });
    expect(res.status).toBe(200);
  });

  it("async error returns 500", async () => {
    createDataset.mockRejectedValue(new Error("fail"));
    const res = await request(mount()).post("/datasets").send({ name: "n" });
    expect(res.status).toBe(500);
  });

  it("routes/index mounts v1", async () => {
    createDataset.mockResolvedValue({ dataset_id: "d" });
    const app = express();
    app.use(express.json());
    app.use("/", routesIndex);
    const res = await request(app).post("/datasets").send({ name: "n" });
    expect(res.status).toBe(201);
  });
});
