import { normalizeBaseUrl } from "../src/handler";

describe("e2e-runner helpers", () => {
  it("normalizeBaseUrl strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeBaseUrl("https://example.com")).toBe("https://example.com");
  });
});
