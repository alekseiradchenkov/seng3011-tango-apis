export type FeatureSpec = {
  feature_list: string[];
  mean: number[];
  std: number[];
};

export type LogisticModel = {
  bias: number;
  weights: number[]; // aligned to feature_list
  spec: FeatureSpec;
};

export function sigmoid(z: number): number {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

export function standardizeRow(x: number[], spec: FeatureSpec): number[] {
  return x.map((v, i) => (v - spec.mean[i]) / (spec.std[i] || 1));
}

export function predictProbability(model: LogisticModel, x: number[]): number {
  const xs = standardizeRow(x, model.spec);
  let z = model.bias;
  for (let i = 0; i < model.weights.length; i++) z += model.weights[i] * xs[i];
  return sigmoid(z);
}

export function computeAuc(y: number[], score: number[]): number {
  const n = y.length;
  if (n === 0) return 0;
  const pairs = y.map((yi, i) => ({ yi, si: score[i] ?? 0 }));
  pairs.sort((a, b) => a.si - b.si);

  // Rank-based AUC with average ranks for ties.
  let rank = 1;
  let sumPosRanks = 0;
  let nPos = 0;
  let nNeg = 0;

  for (let i = 0; i < pairs.length; ) {
    let j = i + 1;
    while (j < pairs.length && pairs[j].si === pairs[i].si) j++;
    const avgRank = (rank + (rank + (j - i) - 1)) / 2;
    for (let k = i; k < j; k++) {
      if (pairs[k].yi === 1) {
        sumPosRanks += avgRank;
        nPos++;
      } else {
        nNeg++;
      }
    }
    rank += j - i;
    i = j;
  }

  if (nPos === 0 || nNeg === 0) return 0.5;
  return (sumPosRanks - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function computePrecisionRecall(y: number[], score: number[], threshold = 0.5) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < y.length; i++) {
    const pred = (score[i] ?? 0) >= threshold ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp++;
    if (pred === 1 && y[i] === 0) fp++;
    if (pred === 0 && y[i] === 1) fn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  return { precision, recall };
}

export function fitLogisticRegression(
  feature_list: string[],
  X: number[][],
  y: number[],
  opts?: { iters?: number; lr?: number; l2?: number },
): { model: LogisticModel; metrics: { auc: number; precision: number; recall: number } } {
  const n = X.length;
  const m = feature_list.length;
  if (n === 0) {
    return {
      model: { bias: 0, weights: new Array(m).fill(0), spec: { feature_list, mean: new Array(m).fill(0), std: new Array(m).fill(1) } },
      metrics: { auc: 0.5, precision: 0, recall: 0 },
    };
  }

  const mean = new Array(m).fill(0);
  const std = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j] ?? 0;
    mean[j] = s / n;
  }
  for (let j = 0; j < m; j++) {
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const d = (X[i][j] ?? 0) - mean[j];
      ss += d * d;
    }
    const v = Math.sqrt(ss / Math.max(1, n - 1));
    std[j] = v > 1e-12 ? v : 1;
  }

  const iters = opts?.iters ?? 2000;
  const lr = opts?.lr ?? 0.1;
  const l2 = opts?.l2 ?? 1e-3;

  let bias = 0;
  const w = new Array(m).fill(0);

  for (let it = 0; it < iters; it++) {
    let gradB = 0;
    const gradW = new Array(m).fill(0);

    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < m; j++) z += w[j] * (((X[i][j] ?? 0) - mean[j]) / std[j]);
      const p = sigmoid(z);
      const err = p - (y[i] ?? 0);
      gradB += err;
      for (let j = 0; j < m; j++) gradW[j] += err * (((X[i][j] ?? 0) - mean[j]) / std[j]);
    }

    gradB /= n;
    for (let j = 0; j < m; j++) {
      gradW[j] = gradW[j] / n + l2 * w[j];
    }

    bias -= lr * gradB;
    for (let j = 0; j < m; j++) w[j] -= lr * gradW[j];
  }

  const spec: FeatureSpec = { feature_list, mean, std };
  const model: LogisticModel = { bias, weights: w, spec };
  const score = X.map((row) => predictProbability(model, row));
  const auc = computeAuc(y, score);
  const pr = computePrecisionRecall(y, score, 0.5);
  return { model, metrics: { auc, precision: pr.precision, recall: pr.recall } };
}

