/**
 * Auth server.ts smoke tests.
 */

jest.mock("cors", () => () => (_req: unknown, _res: unknown, next: () => void) => next(), { virtual: true });
jest.mock("morgan", () => () => (_req: unknown, _res: unknown, next: () => void) => next(), { virtual: true });

jest.mock("../src/routes", () => {
  const { Router } = require("express");
  const r = Router();
  r.get("/ping", (_q: unknown, res: { status: (n: number) => { send: (s: string) => void } }) =>
    res.status(200).send("pong"),
  );
  r.get("/err", (_q: unknown, _r: unknown, next: (e: Error) => void) => next(new Error("x")));
  return r;
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");
import { app } from "../src/server";

describe("auth server", () => {
  it("404 unknown path", async () => {
    const res = await request(app).get("/zzz");
    expect(res.status).toBe(404);
  });

  it("stub ping", async () => {
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
  });

  it("error middleware json", async () => {
    const res = await request(app).get("/err");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL");
  });
});
