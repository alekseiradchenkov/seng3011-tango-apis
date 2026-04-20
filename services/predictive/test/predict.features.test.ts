import { computeFeatureVector, computeLabel, FEATURE_LIST } from "../src/services/predict.features";

describe("predict.features", () => {
  it("computeLabel flags a spike within horizon", () => {
    const series = [
      { date: "2026-01-01", close: 100 },
      { date: "2026-01-02", close: 100 },
      { date: "2026-01-03", close: 110 }, // +10%
      { date: "2026-01-04", close: 109 },
      { date: "2026-01-05", close: 109 },
      { date: "2026-01-06", close: 109 },
      { date: "2026-01-07", close: 109 },
      { date: "2026-01-08", close: 109 },
    ];
    expect(computeLabel(series as any, 1, 7, 0.05)).toBe(1);
  });

  it("computeFeatureVector returns null if insufficient history", () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      close: 100 + i,
    }));
    const x = computeFeatureVector(series as any, 9, { cpi_level: 0, cpi_qoq: 0, unemp_level: 0, unemp_mom: 0 });
    expect(x).toBeNull();
  });

  it("computeFeatureVector returns the expected shape and finite values", () => {
    const series = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      close: 100 + i,
    }));
    const x = computeFeatureVector(series as any, 29, { cpi_level: 95, cpi_qoq: 0.01, unemp_level: 3.7, unemp_mom: 0.1 });
    expect(x).not.toBeNull();
    expect(x!.length).toBe(FEATURE_LIST.length);
    expect(x!.every((v) => Number.isFinite(v))).toBe(true);
  });
});

