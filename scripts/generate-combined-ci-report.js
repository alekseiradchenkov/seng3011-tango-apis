#!/usr/bin/env node
/**
 * Builds a single Markdown + plain-text CI report from:
 * - Per-service Jest `jest-results.json` + optional `jest.exitcode`
 * - Per-service `coverage-summary.json` (Istanbul)
 * - Per-service ESLint `eslint-report.json` + optional `eslint.exitcode`
 *
 * Artifacts are expected under `coverage-parts/<service>/...` and `lint-parts/<service>/...`.
 *
 * Usage: `node scripts/generate-combined-ci-report.js <coverage-parts> <lint-parts> <out-dir>`
 * If `lint-parts` is missing or empty, lint sections show as unavailable.
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
  "predictive",
  "e2e-runner",
]);

/** Max failing test entries (each may include message blocks). */
const MAX_FAILURE_ITEMS = 40;
const MAX_ESLINT_ROWS = 60;

/**
 * @param {string} root
 * @param {string} baseName
 * @returns {string | null}
 */
function findFileInTree(root, baseName) {
  /** @type {string[]} */
  const found = [];
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
      else if (ent.name === baseName) found.push(p);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return found.sort()[0] || null;
}

/**
 * @param {string} root
 * @returns {string | null}
 */
function readTiny(root, baseName) {
  const p = findFileInTree(root, baseName);
  if (!p) return null;
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown> | null} jestJson
 * @returns {{
 *   total: number;
 *   passed: number;
 *   failed: number;
 *   pending: number;
 *   totalSuites: number;
 *   failedSuites: number;
 *   passedSuites: number;
 *   success: boolean | null;
 *   failures: { fullName: string; messages: string[] }[];
 * } | null}
 */
function summarizeJest(jestJson) {
  if (!jestJson || typeof jestJson !== "object") return null;
  const total =
    typeof jestJson.numTotalTests === "number"
      ? jestJson.numTotalTests
      : null;
  const passed =
    typeof jestJson.numPassedTests === "number" ? jestJson.numPassedTests : 0;
  const failed =
    typeof jestJson.numFailedTests === "number" ? jestJson.numFailedTests : 0;
  const pending =
    typeof jestJson.numPendingTests === "number" ? jestJson.numPendingTests : 0;
  const totalSuites =
    typeof jestJson.numTotalTestSuites === "number" ? jestJson.numTotalTestSuites : 0;
  const failedSuites =
    typeof jestJson.numFailedTestSuites === "number" ? jestJson.numFailedTestSuites : 0;
  const passedSuites =
    typeof jestJson.numPassedTestSuites === "number" ? jestJson.numPassedTestSuites : 0;
  const success =
    typeof jestJson.success === "boolean" ? jestJson.success : null;
  /** @type {{ fullName: string; messages: string[] }[]} */
  const failures = [];
  const results = jestJson.testResults;
  if (Array.isArray(results)) {
    for (const tr of results) {
      if (!tr || typeof tr !== "object") continue;
      const assertions = tr.assertionResults;
      if (!Array.isArray(assertions)) continue;
      for (const ar of assertions) {
        if (!ar || typeof ar !== "object" || ar.status !== "failed") continue;
        const fullName =
          typeof ar.fullName === "string"
            ? ar.fullName
            : typeof ar.title === "string"
              ? ar.title
              : "(unknown test)";
        const msgs = Array.isArray(ar.failureMessages)
          ? ar.failureMessages.filter((m) => typeof m === "string")
          : [];
        failures.push({ fullName, messages: msgs });
      }
    }
  }
  return {
    total: total ?? passed + failed + pending,
    passed,
    failed,
    pending,
    totalSuites,
    failedSuites,
    passedSuites,
    success,
    failures,
  };
}

/**
 * @param {unknown} eslintJson
 * @returns {{ errors: number; warnings: number; rows: { file: string; line: number; col: number; severity: string; message: string; rule: string }[] } | null}
 */
function summarizeEslint(eslintJson) {
  if (!Array.isArray(eslintJson)) return null;
  let errors = 0;
  let warnings = 0;
  /** @type {{ file: string; line: number; col: number; severity: string; message: string; rule: string }[]} */
  const rows = [];
  for (const file of eslintJson) {
    if (!file || typeof file !== "object") continue;
    const fp = typeof file.filePath === "string" ? file.filePath : "";
    errors += Number(file.errorCount) || 0;
    warnings += Number(file.warningCount) || 0;
    const messages = Array.isArray(file.messages) ? file.messages : [];
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const sev = m.severity === 2 ? "error" : m.severity === 1 ? "warn" : "info";
      rows.push({
        file: fp,
        line: Number(m.line) || 0,
        col: Number(m.column) || 0,
        severity: sev,
        message: typeof m.message === "string" ? m.message : "",
        rule: typeof m.ruleId === "string" && m.ruleId ? m.ruleId : "",
      });
    }
  }
  return { errors, warnings, rows };
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
 * @param {ReturnType<typeof summarizeJest>} j
 * @returns {string}
 */
function jestOverviewCell(j) {
  if (!j) return "— (no `jest-results.json`)";
  const ok = j.success === true && j.failed === 0;
  const icon = ok ? "OK" : j.failed > 0 ? "FAIL" : "—";
  return `${icon} **${j.passed}** passed / **${j.failed}** failed / **${j.pending}** pending (tests **${j.total}**, suites **${j.passedSuites}** ok / **${j.failedSuites}** failed / **${j.totalSuites}** total)`;
}

/**
 * @param {ReturnType<typeof summarizeEslint>} e
 * @returns {string}
 */
function eslintOverviewCell(e) {
  if (!e) return "— (no lint artifact)";
  if (e.errors === 0 && e.warnings === 0) return `clean (**0** errors, **0** warnings)`;
  return `**${e.errors}** errors, **${e.warnings}** warnings`;
}

/**
 * @param {{
 *   service: string;
 *   coverageData: Record<string, unknown> | null;
 *   jest: ReturnType<typeof summarizeJest>;
 *   jestExit: string | null;
 *   eslint: ReturnType<typeof summarizeEslint>;
 *   eslintExit: string | null;
 * }[]} svcRows
 * @param {{ total: Record<string, { pct: number; covered: number; total: number }> }} mergedCov
 * @returns {string}
 */
function buildMarkdown(svcRows, mergedCov) {
  const lines = [];
  lines.push("# Combined CI report");
  lines.push("");
  lines.push(
    "Generated from **`coverage-parts`** (Jest + Istanbul) and **`lint-parts`** (ESLint JSON) produced by the same workflow. This is a post-run rollup; individual job logs have full stack traces."
  );
  lines.push("");

  lines.push("## Overview");
  lines.push("");
  lines.push("| Service | Jest | Lines % | ESLint |");
  lines.push("| --- | --- | ---: | --- |");
  for (const row of svcRows) {
    const total = row.coverageData?.total;
    const t =
      total && typeof total === "object" && "lines" in total
        ? /** @type {{ pct?: number }} */ (total.lines)
        : null;
    const linePct =
      t && typeof t.pct === "number" ? `${t.pct}%` : "—";
    lines.push(
      `| **${row.service}** | ${jestOverviewCell(row.jest)} | ${linePct} | ${eslintOverviewCell(row.eslint)} |`
    );
  }
  lines.push("");

  const sumPassed = svcRows.reduce((a, r) => a + (r.jest?.passed ?? 0), 0);
  const sumFailed = svcRows.reduce((a, r) => a + (r.jest?.failed ?? 0), 0);
  const sumPending = svcRows.reduce((a, r) => a + (r.jest?.pending ?? 0), 0);
  const sumTotal = svcRows.reduce((a, r) => a + (r.jest?.total ?? 0), 0);
  const sumTS = svcRows.reduce((a, r) => a + (r.jest?.totalSuites ?? 0), 0);
  const sumFS = svcRows.reduce((a, r) => a + (r.jest?.failedSuites ?? 0), 0);
  const sumPS = svcRows.reduce((a, r) => a + (r.jest?.passedSuites ?? 0), 0);
  const sumE = svcRows.reduce((a, r) => a + (r.eslint?.errors ?? 0), 0);
  const sumW = svcRows.reduce((a, r) => a + (r.eslint?.warnings ?? 0), 0);
  lines.push("### Rollups");
  lines.push("");
  lines.push(
    `- **Tests (summed across services):** ${sumPassed} passed, ${sumFailed} failed, ${sumPending} pending, **${sumTotal}** total assertions (Jest).`
  );
  lines.push(
    `- **Test suites (summed):** ${sumPS} passed, ${sumFS} failed, **${sumTS}** total suites.`
  );
  lines.push(
    `- **ESLint (summed):** ${sumE} errors, ${sumW} warnings (same services may also run in the standalone **lint** workflow on the same event).`
  );
  lines.push("");

  for (const row of svcRows) {
    lines.push(`## ${row.service}`);
    lines.push("");

    lines.push("### Tests (Jest)");
    lines.push("");
    if (!row.jest) {
      lines.push("_No `jest-results.json` (job skipped or failed before write)._");
    } else {
      const je = row.jestExit != null ? `\`jest.exitcode\`: **${row.jestExit}**` : "";
      lines.push(`- ${jestOverviewCell(row.jest)}${je ? ` · ${je}` : ""}`);
      lines.push("");
      if (row.jest.failures.length === 0) {
        lines.push("_No failing assertions in report._");
      } else {
        lines.push("<details><summary>Failing tests (expand)</summary>");
        lines.push("");
        let shown = 0;
        for (const f of row.jest.failures) {
          if (shown >= MAX_FAILURE_ITEMS) {
            lines.push(
              `\n_…and ${row.jest.failures.length - shown} more failing assertions (see job log)._`
            );
            break;
          }
          lines.push(`- **${f.fullName.replace(/\|/g, "\\|")}**`);
          for (const msg of f.messages.slice(0, 3)) {
            const block = msg.length > 1200 ? `${msg.slice(0, 1200)}…` : msg;
            lines.push("");
            lines.push("```text");
            lines.push(block);
            lines.push("```");
          }
          shown += 1;
        }
        lines.push("");
        lines.push("</details>");
      }
    }
    lines.push("");

    lines.push("### Coverage (Istanbul summary)");
    lines.push("");
    const covTotal = row.coverageData?.total;
    if (!covTotal || typeof covTotal !== "object") {
      lines.push("_No `coverage-summary.json`._");
    } else {
      lines.push("| Metric | % | Covered | Total |");
      lines.push("| --- | ---: | ---: | ---: |");
      for (const key of METRICS) {
        const v = /** @type {{ pct?: number; covered?: number; total?: number } | undefined} */ (
          covTotal[/** @type {keyof typeof covTotal} */ (key)]
        );
        lines.push(rowMetricMarkdown(key, v));
      }
    }
    lines.push("");

    lines.push("### Lint (ESLint)");
    lines.push("");
    if (!row.eslint) {
      lines.push("_No `eslint-report.json` (lint job artifact missing for this service)._");
    } else {
      const ee =
        row.eslintExit != null ? `\`eslint.exitcode\`: **${row.eslintExit}**` : "";
      lines.push(`- ${eslintOverviewCell(row.eslint)}${ee ? ` · ${ee}` : ""}`);
      lines.push("");
      if (row.eslint.rows.length === 0) {
        lines.push("_No rule violations in report._");
      } else {
        lines.push("| File | Line | Sev | Rule | Message |");
        lines.push("| --- | ---: | --- | --- | --- |");
        let shown = 0;
        for (const r of row.eslint.rows) {
          if (shown >= MAX_ESLINT_ROWS) break;
          const rel = r.file.replace(/\\/g, "/");
          const msg = r.message.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 200);
          lines.push(`| \`${rel}\` | ${r.line} | ${r.severity} | ${r.rule || "—"} | ${msg} |`);
          shown += 1;
        }
        if (row.eslint.rows.length > MAX_ESLINT_ROWS) {
          lines.push(`| … | | | | _(${row.eslint.rows.length - MAX_ESLINT_ROWS} more rows)_ |`);
        }
      }
    }
    lines.push("");
  }

  lines.push("## Combined coverage (all services)");
  lines.push("");
  lines.push("| Metric | % | Covered | Total |");
  lines.push("| --- | ---: | ---: | ---: |");
  const t = mergedCov.total || {};
  for (const key of METRICS) {
    lines.push(rowMetricMarkdown(key, t[key]));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {Parameters<typeof buildMarkdown>[0]} svcRows
 * @param {Parameters<typeof buildMarkdown>[1]} mergedCov
 * @returns {string}
 */
function buildPlainText(svcRows, mergedCov) {
  const lines = [];
  lines.push("COMBINED CI REPORT");
  lines.push("=".repeat(50));
  lines.push("");

  for (const row of svcRows) {
    lines.push(`### ${row.service}`);
    lines.push("");
    if (row.jest) {
      lines.push(
        `  Jest:  ${row.jest.passed} passed, ${row.jest.failed} failed, ${row.jest.pending} pending (total ${row.jest.total})`
      );
      if (row.jestExit != null) lines.push(`  jest.exitcode: ${row.jestExit}`);
      let n = 0;
      for (const f of row.jest.failures) {
        if (n >= 20) {
          lines.push(`  ... (${row.jest.failures.length - n} more failures)`);
          break;
        }
        lines.push(`  FAIL: ${f.fullName}`);
        n += 1;
      }
    } else lines.push("  Jest: (no jest-results.json)");
    lines.push("");
    if (row.coverageData?.total && typeof row.coverageData.total === "object") {
      lines.push("  Coverage:");
      const tot = row.coverageData.total;
      for (const key of METRICS) {
        const d = tot[key];
        if (d && typeof d.pct === "number")
          lines.push(`    ${key}: ${d.pct}% (${d.covered}/${d.total})`);
      }
    } else lines.push("  Coverage: (none)");
    lines.push("");
    if (row.eslint) {
      lines.push(`  ESLint: ${row.eslint.errors} errors, ${row.eslint.warnings} warnings`);
      if (row.eslintExit != null) lines.push(`  eslint.exitcode: ${row.eslintExit}`);
    } else lines.push("  ESLint: (no eslint-report.json)");
    lines.push("");
  }

  lines.push("COMBINED COVERAGE");
  lines.push("-".repeat(30));
  const t = mergedCov.total || {};
  for (const key of METRICS) {
    const d = t[key];
    if (d && typeof d.pct === "number")
      lines.push(`  ${key}: ${d.pct}% (${d.covered}/${d.total})`);
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const coverageParts = process.argv[2] || "coverage-parts";
  const lintParts = process.argv[3] || "lint-parts";
  const outDir = process.argv[4] || "coverage-combined";

  /** @type {{ service: string; coverageData: Record<string, unknown> | null; jest: ReturnType<typeof summarizeJest>; jestExit: string | null; eslint: ReturnType<typeof summarizeEslint>; eslintExit: string | null }[]} */
  const svcRows = [];

  for (const service of SERVICE_ORDER) {
    const cRoot = path.join(coverageParts, service);
    const lRoot = path.join(lintParts, service);

    const sumPath = findSummaryFiles(cRoot)[0] || null;
    let coverageData = null;
    if (sumPath) {
      try {
        coverageData = JSON.parse(fs.readFileSync(sumPath, "utf8"));
      } catch {
        coverageData = null;
      }
    }

    const jestPath = findFileInTree(cRoot, "jest-results.json");
    let jestJson = null;
    if (jestPath) {
      try {
        jestJson = JSON.parse(fs.readFileSync(jestPath, "utf8"));
      } catch {
        jestJson = null;
      }
    }

    const eslintPath = findFileInTree(lRoot, "eslint-report.json");
    let eslintJson = null;
    if (eslintPath) {
      try {
        eslintJson = JSON.parse(fs.readFileSync(eslintPath, "utf8"));
      } catch {
        eslintJson = null;
      }
    }

    svcRows.push({
      service,
      coverageData,
      jest: summarizeJest(jestJson),
      jestExit: readTiny(cRoot, "jest.exitcode"),
      eslint: summarizeEslint(eslintJson),
      eslintExit: readTiny(lRoot, "eslint.exitcode"),
    });
  }

  const covPaths = svcRows.map((r) => findSummaryFiles(path.join(coverageParts, r.service))[0]).filter(Boolean);
  let merged = { total: {} };
  if (covPaths.length > 0) merged = mergeSummaries(covPaths);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "coverage-summary.json"), `${JSON.stringify(merged, null, 2)}\n`);

  const md = buildMarkdown(svcRows, merged);
  const txt = buildPlainText(svcRows, merged);

  fs.writeFileSync(path.join(outDir, "COMBINED-CI-REPORT.md"), md);
  fs.writeFileSync(path.join(outDir, "COMBINED-CI-REPORT.txt"), txt);

  // Back-compat filenames for scripts/docs that still expect COVERAGE-REPORT.*
  fs.writeFileSync(path.join(outDir, "COVERAGE-REPORT.md"), md);
  fs.writeFileSync(path.join(outDir, "COVERAGE-REPORT.txt"), txt);

  console.log("Wrote", path.join(outDir, "COMBINED-CI-REPORT.md"));
}

if (require.main === module) {
  main();
}

module.exports = {
  findFileInTree,
  summarizeJest,
  summarizeEslint,
  buildMarkdown,
  buildPlainText,
};
