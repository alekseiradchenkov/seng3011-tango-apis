import * as fs from "fs";
import * as path from "path";
import newman, { type NewmanRunSummary } from "newman";

/** Postman collections shipped next to the Lambda bundle (see CDK afterBundling). */
const COLLECTION_FILE_SUFFIX = ".collection.json";

export type CollectionRunResult = {
  name: string;
  ok: boolean;
  assertionFailures: number;
  failedRequestCount: number;
};

export type E2EPayload = {
  ok: boolean;
  apiBaseUrl: string;
  collections: CollectionRunResult[];
  error?: string;
};

/**
 * Resolves the directory containing bundled `integration-tests/*.collection.json` files.
 */
export function integrationTestsDir(): string {
  return path.join(__dirname, "integration-tests");
}

/**
 * Normalizes the API base URL (no trailing slash) for Postman collection variables.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

/**
 * Returns all bundled `*.collection.json` filenames in the integration-tests directory.
 * The CDK bundling step ensures the directory exists inside the Lambda bundle.
 */
function listCollectionFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(COLLECTION_FILE_SUFFIX))
    .map((e) => e.name)
    .sort();
}

/**
 * Executes a single Postman collection via Newman and resolves with the Newman run summary.
 */
function runOneCollection(collectionPath: string, baseUrl: string): Promise<NewmanRunSummary> {
  return new Promise((resolve, reject) => {
    newman.run(
      {
        collection: collectionPath,
        reporters: ["cli"],
        silent: true,
        envVar: [{ key: "baseUrl", value: baseUrl }],
      },
      (err: Error | null, summary?: NewmanRunSummary) => {
        if (err) {
          reject(err);
          return;
        }
        if (!summary) {
          reject(new Error("Newman returned no summary"));
          return;
        }
        resolve(summary);
      },
    );
  });
}

/**
 * Runs all integration Newman collections sequentially against `API_BASE_URL`.
 * @returns Aggregate result suitable for Lambda invoke response.
 */
export async function runE2E(): Promise<E2EPayload> {
  const raw = process.env.API_BASE_URL;
  if (!raw) {
    return {
      ok: false,
      apiBaseUrl: "",
      collections: [],
      error: "Missing API_BASE_URL",
    };
  }

  const apiBaseUrl = normalizeBaseUrl(raw);
  const dir = integrationTestsDir();
  if (!fs.existsSync(dir)) {
    return {
      ok: false,
      apiBaseUrl,
      collections: [],
      error: `integration-tests directory not found: ${dir}`,
    };
  }

  const collectionFiles = listCollectionFiles(dir);
  if (collectionFiles.length === 0) {
    return {
      ok: false,
      apiBaseUrl,
      collections: [],
      error: `No *${COLLECTION_FILE_SUFFIX} files found in ${dir}`,
    };
  }

  const collections: CollectionRunResult[] = [];
  let allOk = true;

  for (const file of collectionFiles) {
    const collectionPath = path.join(dir, file);
    // collectionFiles are derived from directory entries, so the path should exist.

    try {
      const summary = await runOneCollection(collectionPath, apiBaseUrl);
      const stats = summary.run.stats;
      const assertionFailures = stats.assertions?.failed ?? 0;
      const failedRequests = (stats as { requests?: { failed?: number } }).requests?.failed ?? 0;
      const ok = assertionFailures === 0 && failedRequests === 0;
      if (!ok) allOk = false;
      collections.push({
        name: file,
        ok,
        assertionFailures,
        failedRequestCount: failedRequests,
      });
    } catch (e) {
      allOk = false;
      collections.push({
        name: file,
        ok: false,
        assertionFailures: 0,
        failedRequestCount: 0,
      });
      return {
        ok: false,
        apiBaseUrl,
        collections,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return { ok: allOk, apiBaseUrl, collections };
}
