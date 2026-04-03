import { runE2E } from "./handler";

/**
 * AWS Lambda entry: runs Newman E2E collections against the deployed HTTP API (`API_BASE_URL`).
 */
export const handler = async (): Promise<unknown> => {
  return runE2E();
};
