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

// Stub v0 with just the /collection/status route so no swagger file is needed on disk.
jest.mock("../src/routes/v0.route", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/collection/status", (_req: any, res: any) =>
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() }),
  );
  // Return the router directly (not { default: router }) so CommonJS default import resolves correctly.
  return router;
});

// Stub v1 with a /ping success route and two /crash routes that call next(err) so we
// can exercise the server-level error-handler middleware without running the dataset tests.
jest.mock("../src/routes/v1.route", () => {
  const { Router } = require("express");
  const router = Router();

  // Simple success route — verifies that v1 is mounted and reachable through server.ts
  router.get("/ping", (_req: any, res: any) => res.status(200).json({ pong: true }));

  // Passes an error with a specific status code to next() — exercises the err.status branch
  router.get("/crash", (_req: any, _res: any, next: any) => {
    next(Object.assign(new Error("test error"), { status: 503 }));
  });

  // Passes an error with no status to next() — exercises the || 500 fallback branch
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

  // GET /v1/does-not-exist
  // Pass = 404 for an unknown path nested under the /v1 prefix
  it("returns 404 for an unknown path nested under a mounted prefix", async () => {
    const res = await request(app).get("/v1/does-not-exist");
    expect(res.status).toBe(404);
  });

  // server.ts — v0 routes via app.use("/", routes)
  // The v0 router is mounted through the shared routes index; these tests confirm
  // the middleware chain is wired correctly end-to-end.

  // GET /v0/collection/status
  // Pass = 200 + response body contains a timestamp field
  it("v0 collection/status responds with 200 and a timestamp", async () => {
    const res = await request(app).get("/v0/collection/status");
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
  });

  // GET /v0/collection/status
  // Pass = response body status field equals "ok"
  it("v0 collection/status responds with status ok", async () => {
    const res = await request(app).get("/v0/collection/status");
    expect(res.body.status).toBe("ok");
  });

  // server.ts — v1 routes via app.use("/", routes)
  // Confirms the v1 router is mounted and requests flow through the full middleware stack.

  // GET /v1/ping
  // Pass = 200 + { pong: true } confirming v1 is reachable through the server
  it("v1 ping route responds with 200 through the real server middleware stack", async () => {
    const res = await request(app).get("/v1/ping");
    expect(res.status).toBe(200);
    expect(res.body.pong).toBe(true);
  });

  // server.ts — error-handler middleware (lines 30-32)
  // Errors passed to next(err) are handled by the (err, req, res, next) middleware.
  // Pass (err.status set)   = response uses the status code from the error object
  // Pass (err.status unset) = response falls back to 500

  // GET /v1/crash
  // Pass = response status matches the status property on the error (503)
  it("returns the error status when a route calls next(err) with a status property", async () => {
    // Covers: res.status(err.status || 500) where err.status === 503
    const res = await request(app).get("/v1/crash");
    expect(res.status).toBe(503);
  });

  // GET /v1/crash500
  // Pass = response status is 500 when the error has no status property
  it("falls back to 500 when the error passed to next() has no status property", async () => {
    // Covers: err.status || 500 → 500 fallback branch
    const res = await request(app).get("/v1/crash500");
    expect(res.status).toBe(500);
  });
});
