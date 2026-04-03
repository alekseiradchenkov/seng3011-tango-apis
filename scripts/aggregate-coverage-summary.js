#!/usr/bin/env node
/**
 * Recursively finds Istanbul `coverage-summary.json` files (from Jest `--coverage`)
 * under a root directory and merges their `total` metrics into one summary object.
 *
 * Used by CI to produce a single platform-level `pct` view after per-service runs.
 *
 * @param {string} root - Directory to search (e.g. downloaded artifact tree).
 * @returns {string[]} Absolute or rooted paths to each `coverage-summary.json` found.
 */
function findSummaryFiles(root) {
  const fs = require("fs");
  const path = require("path");
  /** @type {string[]} */
  const out = [];
  /**
   * @param {string} d
   * @returns {void}
   */
  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name === "coverage-summary.json") out.push(p);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return out;
}

/**
 * @param {string[]} paths - Paths to `coverage-summary.json` files.
 * @returns {{ total: Record<string, { total: number; covered: number; skipped: number; pct: number }> }}
 */
function mergeSummaries(paths) {
  const fs = require("fs");
  const keys = /** @type {const} */ (["lines", "statements", "functions", "branches"]);
  /** @type {{ total: Record<string, { total: number; covered: number; skipped: number; pct: number }> }} */
  const acc = { total: {} };
  for (const k of keys) {
    acc.total[k] = { total: 0, covered: 0, skipped: 0, pct: 0 };
  }

  for (const p of paths) {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const t = data.total || {};
    for (const k of keys) {
      const v = t[k];
      if (!v || typeof v !== "object") continue;
      acc.total[k].total += Number(v.total) || 0;
      acc.total[k].covered += Number(v.covered) || 0;
      acc.total[k].skipped += Number(v.skipped) || 0;
    }
  }

  for (const k of keys) {
    const v = acc.total[k];
    v.pct = v.total === 0 ? 100 : Math.round((v.covered / v.total) * 10000) / 100;
  }

  return acc;
}

function main() {
  const fs = require("fs");
  const path = require("path");

  const root = process.argv[2] || "coverage-parts";
  const outFile = process.argv[3] || path.join("coverage-combined", "coverage-summary.json");

  const files = findSummaryFiles(root);
  if (files.length === 0) {
    console.error("No coverage-summary.json found under", root);
    process.exit(1);
  }

  const merged = mergeSummaries(files);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(merged, null, 2)}\n`);
  console.log("Merged", files.length, "coverage-summary.json ->", outFile);
}

module.exports = { findSummaryFiles, mergeSummaries };

if (require.main === module) {
  main();
}
