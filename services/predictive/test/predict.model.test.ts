import { fitLogisticRegression, predictProbability } from "../src/services/predict.model";

describe("predict.model", () => {
  it("fitLogisticRegression is deterministic for fixed inputs", () => {
    const featureList = ["x1", "x2"];
    const X = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
    ];
    const y = [0, 0, 0, 1, 1, 1];

    const a = fitLogisticRegression(featureList, X, y, { iters: 500, lr: 0.1, l2: 0 });
    const b = fitLogisticRegression(featureList, X, y, { iters: 500, lr: 0.1, l2: 0 });

    expect(a.model.bias).toBeCloseTo(b.model.bias, 10);
    expect(a.model.weights[0]).toBeCloseTo(b.model.weights[0], 10);
    expect(a.model.weights[1]).toBeCloseTo(b.model.weights[1], 10);

    const p = predictProbability(a.model, [2, 2]);
    expect(p).toBeGreaterThan(0.5);
  });
});

