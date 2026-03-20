/**
 * Smoke tests for retrieval server.ts (404, error handler, middleware stack).
 *
 * Run: npx jest test/misc.test.ts
 */

jest.mock("cors", () => () => (_req: unknown, _res: unknown, next: () => void) => next(), { virtual: true });
jest.mock("morgan", () => () => (_req: unknown, _res: unknown, next: () => void) => next(), { virtual: true });

jest.mock("../src/routes", () => {
  const { Router } = require("express");
  const r = Router();
  r.get("/ping", (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(200).json({ pong: true }),
  );
  r.get("/boom", (_req: unknown, _res: unknown, next: (e: Error) => void) => {
    next(new Error("fail"));
  });
  return r;
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");
import { app } from "../src/server";

describe("retrieval server", () => {
  it("returns 404 for unknown path", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
  });

  it("reaches stubbed ping", async () => {
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
    expect(res.body.pong).toBe(true);
  });

  it("error handler returns 500 JSON", async () => {
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL");
  });
});
