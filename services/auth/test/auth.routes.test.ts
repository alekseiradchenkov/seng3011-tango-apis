/**
 * Auth HTTP routes with mocked Cognito service.
 */

const signup = jest.fn();
const login = jest.fn();
const logout = jest.fn();

jest.mock("../src/services/cognitoAuth.service", () => ({
  signup: (...a: unknown[]) => signup(...a),
  login: (...a: unknown[]) => login(...a),
  logout: (...a: unknown[]) => logout(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");
import { app } from "../src/server";

describe("auth routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /auth/signup 400 without body", async () => {
    const res = await request(app).post("/auth/signup").send({});
    expect(res.status).toBe(400);
  });

  it("POST /auth/signup 201", async () => {
    signup.mockResolvedValue(undefined);
    const res = await request(app).post("/auth/signup").send({ email: "a@b.com", password: "pw" });
    expect(res.status).toBe(201);
  });

  it("POST /auth/signup 409 UsernameExistsException", async () => {
    const err = Object.assign(new Error("exists"), { name: "UsernameExistsException" });
    signup.mockRejectedValue(err);
    const res = await request(app).post("/auth/signup").send({ email: "a@b.com", password: "pw" });
    expect(res.status).toBe(409);
  });

  it("POST /auth/signup 500 other error", async () => {
    signup.mockRejectedValue(new Error("boom"));
    const res = await request(app).post("/auth/signup").send({ email: "a@b.com", password: "pw" });
    expect(res.status).toBe(500);
  });

  it("POST /auth/login 400", async () => {
    const res = await request(app).post("/auth/login").send({});
    expect(res.status).toBe(400);
  });

  it("POST /auth/login 200", async () => {
    login.mockResolvedValue({ accessToken: "a" });
    const res = await request(app).post("/auth/login").send({ email: "a@b.com", password: "pw" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe("a");
  });

  it("POST /auth/login 401", async () => {
    login.mockRejectedValue(new Error("bad creds"));
    const res = await request(app).post("/auth/login").send({ email: "a@b.com", password: "pw" });
    expect(res.status).toBe(401);
  });

  it("POST /auth/logout 400 without token", async () => {
    const res = await request(app).post("/auth/logout").send({});
    expect(res.status).toBe(400);
  });

  it("POST /auth/logout 200 with Bearer", async () => {
    logout.mockResolvedValue(undefined);
    const res = await request(app).post("/auth/logout").set("Authorization", "Bearer tok").send();
    expect(res.status).toBe(200);
  });

  it("POST /auth/logout 200 with body accessToken", async () => {
    logout.mockResolvedValue(undefined);
    const res = await request(app).post("/auth/logout").send({ accessToken: "x" });
    expect(res.status).toBe(200);
  });

  it("POST /auth/logout 500", async () => {
    logout.mockRejectedValue(new Error("signout failed"));
    const res = await request(app).post("/auth/logout").send({ accessToken: "x" });
    expect(res.status).toBe(500);
  });
});
