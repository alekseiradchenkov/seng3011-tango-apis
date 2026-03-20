/**
 * Smoke tests for server bootstrap and route registration.
 *
 * Covers server.ts middleware wiring, the 404 catch-all, and the error-handler.
 * v0 and v1 routers are stubbed so swagger, yaml, and the database layer are
 * never touched by these tests.
 *
 * Run:      npx jest test/misc.test.ts
 * Coverage: npx jest test/misc.test.ts --coverage
 */

// ─── Module mocks ─────────────────────────────────────────────────────────────
// All mocks must be declared before any imports so Jest hoists them correctly.

jest.mock("cors", () => () => (_req: any, _res: any, next: any) => next(), { virtual: true });
jest.mock("morgan", () => () => (_req: any, _res: any, next: any) => next(), { virtual: true });

// Stub routes index with a couple of test routes so we can validate
// server-level wiring (404 and error handler) without depending on service routes.
jest.mock("../src/routes", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/ping", (_req: any, res: any) => res.status(200).json({ pong: true }));
  router.get("/crash", (_req: any, _res: any, next: any) => {
    next(Object.assign(new Error("test error"), { status: 503 }));
  });
  router.get("/crash500", (_req: any, _res: any, next: any) => {
    next(new Error("no status set"));
  });
  return router;
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");
import { app } from "../src/server";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Server bootstrap — smoke tests for server.ts and route registration", () => {

  // server.ts — 404 catch-all handler
  // Any request whose path does not match a registered route should return 404.
  // Pass = 404 for a completely unknown path
  // Pass = 404 for an unknown path nested under a known prefix

  // GET /random-route
  // Pass = 404 for a path that matches no registered route
  it("returns 404 for a route that does not exist", async () => {
    const res = await request(app).get("/random-route");
    expect(res.status).toBe(404);
  });

  // GET /datasets/does-not-exist
  // Pass = 404 for an unknown path nested under a known prefix
  it("returns 404 for an unknown path nested under a mounted prefix", async () => {
    const res = await request(app).get("/datasets/does-not-exist");
    expect(res.status).toBe(404);
  });

  // server.ts — v1 routes via app.use("/", routes)
  // Confirms the v1 router is mounted and requests flow through the full middleware stack.

  // GET /ping
  // Pass = 200 + { pong: true } confirming v1 is reachable through the server
  it("v1 ping route responds with 200 through the real server middleware stack", async () => {
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
    expect(res.body.pong).toBe(true);
  });

  // server.ts — error-handler middleware (lines 30-32)
  // Errors passed to next(err) are handled by the (err, req, res, next) middleware.
  // Pass (err.status set)   = response uses the status code from the error object
  // Pass (err.status unset) = response falls back to 500

  // GET /crash
  // Pass = response status matches the status property on the error (503)
  it("returns the error status when a route calls next(err) with a status property", async () => {
    // Covers: res.status(err.status || 500) where err.status === 503
    const res = await request(app).get("/crash");
    expect(res.status).toBe(503);
  });

  // GET /crash500
  // Pass = response status is 500 when the error has no status property
  it("falls back to 500 when the error passed to next() has no status property", async () => {
    // Covers: err.status || 500 → 500 fallback branch
    const res = await request(app).get("/crash500");
    expect(res.status).toBe(500);
  });
});
