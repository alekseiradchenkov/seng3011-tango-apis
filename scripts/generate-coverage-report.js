#!/usr/bin/env node
/**
 * Builds human-readable coverage summaries from per-service `coverage-summary.json`
 * files under `coverage-parts/<service>/` (CI artifact layout).
 *
 * Writes:
 * - `coverage-summary.json` — merged totals (same shape as Istanbul json-summary)
 * - `COVERAGE-REPORT.md` — Markdown tables (per service + combined)
 * - `COVERAGE-REPORT.txt` — plain-text variant for quick viewing
 *
 * @module generate-coverage-report
 */

const fs = require("fs");
const path = require("path");
const { findSummaryFiles, mergeSummaries } = require("./aggregate-coverage-summary.js");

const METRICS = /** @type {const} */ (["lines", "statements", "functions", "branches"]);
const SERVICE_ORDER = /** @type {const} */ ([
  "auth",
  "collection",
  "retrieval",
  "visualisation",
  "e2e-runner",
]);

/**
 * @param {string} partsRoot
 * @returns {{ service: string; path: string | null; data: Record<string, unknown> | null }[]}
 */
function collectPerService(partsRoot) {
  return SERVICE_ORDER.map((service) => {
    const root = path.join(partsRoot, service);
    const paths = findSummaryFiles(root);
    const p = paths[0] || null;
    let data = null;
    if (p) {
      try {
        data = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        data = null;
      }
    }
    return { service, path: p, data };
  });
}

/**
 * @param {string} label
 * @param {{ pct?: number; covered?: number; total?: number } | undefined} detail
 * @returns {string}
 */
function rowMetricMarkdown(label, detail) {
  if (!detail || typeof detail.pct !== "number") {
    return `| ${label} | — | — | — |`;
  }
  const cov = detail.covered != null ? String(detail.covered) : "—";
  const tot = detail.total != null ? String(detail.total) : "—";
  return `| ${label} | ${detail.pct}% | ${cov} | ${tot} |`;
}

/**
 * @param {{ service: string; data: Record<string, unknown> | null }[]} rows
 * @param {{ total: Record<string, { pct: number; covered: number; total: number }> }} merged
 * @returns {string}
 */
function buildMarkdown(rows, merged) {
  const lines = [];
  lines.push("# Jest coverage (all services)");
  lines.push("");
  lines.push(
    "Values come from each job’s `coverage/coverage-summary.json` (same data as the Jest `--coverage` table). **Combined** adds covered/total across services, then recomputes %."
  );
  lines.push("");
  for (const { service, data } of rows) {
    lines.push(`## ${service}`);
    lines.push("");
    const total = data && typeof data === "object" && "total" in data ? data.total : null;
    if (!total || typeof total !== "object") {
      lines.push("_No coverage artifact for this service (skipped or failed before upload)._");
      lines.push("");
      continue;
    }
    lines.push("| Metric | % | Covered | Total |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const key of METRICS) {
      const v = /** @type {{ pct?: number; covered?: number; total?: number } | undefined} */ (
        total[/** @type {keyof typeof total} */ (key)]
      );
      lines.push(rowMetricMarkdown(key, v));
    }
    lines.push("");
  }
  lines.push("## Combined (all services with data)");
  lines.push("");
  const t = merged.total || {};
  lines.push("| Metric | % | Covered | Total |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const key of METRICS) {
    lines.push(rowMetricMarkdown(key, t[key]));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {{ service: string; data: Record<string, unknown> | null }[]} rows
 * @param {{ total: Record<string, { pct: number; covered: number; total: number }> }} merged
 * @returns {string}
 */
function buildPlainText(rows, merged) {
  const lines = [];
  lines.push("Jest coverage (all services)");
  lines.push("=".repeat(44));
  lines.push("");
  const labelW = 12;
  for (const { service, data } of rows) {
    lines.push(`[${service}]`);
    const total = data && typeof data === "object" && "total" in data ? data.total : null;
    if (!total || typeof total !== "object") {
      lines.push("  (no coverage artifact)");
      lines.push("");
      continue;
    }
    for (const key of METRICS) {
      const d = /** @type {{ pct?: number; covered?: number; total?: number } | undefined} */ (
        total[/** @type {keyof typeof total} */ (key)]
      );
      if (!d || typeof d.pct !== "number") continue;
      lines.push(
        `  ${key.padEnd(labelW)} ${String(d.pct).padStart(6)}%   ${d.covered ?? "?"}/${d.total ?? "?"}`
      );
    }
    lines.push("");
  }
  lines.push("[combined]");
  for (const key of METRICS) {
    const d = merged.total[key];
    if (!d || typeof d.pct !== "number") continue;
    lines.push(
      `  ${key.padEnd(labelW)} ${String(d.pct).padStart(6)}%   ${d.covered}/${d.total}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function writeEmptyReport(outDir, partsRoot) {
  fs.mkdirSync(outDir, { recursive: true });
  const msg = `No coverage-summary.json found under ${partsRoot}.`;
  fs.writeFileSync(path.join(outDir, "coverage-summary.json"), `${JSON.stringify({ total: {} }, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outDir, "COVERAGE-REPORT.md"),
    `# Jest coverage (all services)\n\n_${msg}_\n`
  );
  fs.writeFileSync(path.join(outDir, "COVERAGE-REPORT.txt"), `Jest coverage\n${msg}\n`);
  console.warn(msg);
}

function main() {
  const partsRoot = process.argv[2] || "coverage-parts";
  const outDir = process.argv[3] || "coverage-combined";

  const rows = collectPerService(partsRoot);
  const paths = rows.map((r) => r.path).filter(Boolean);
  if (paths.length === 0) {
    writeEmptyReport(outDir, partsRoot);
    return;
  }

  const merged = mergeSummaries(paths);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "coverage-summary.json"), `${JSON.stringify(merged, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "COVERAGE-REPORT.md"), buildMarkdown(rows, merged));
  fs.writeFileSync(path.join(outDir, "COVERAGE-REPORT.txt"), buildPlainText(rows, merged));
  console.log("Wrote", path.join(outDir, "COVERAGE-REPORT.md"), "and coverage-summary.json");
}

module.exports = { collectPerService, buildMarkdown, buildPlainText };

if (require.main === module) {
  main();
}
