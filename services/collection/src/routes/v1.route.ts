import { Request, Response, Router, NextFunction } from "express";
import {
  createDataset,
  updateDataset,
  deleteDataset,
  fetchEvents,
  removeEvents,
} from "../services/datasets.service";

import { checkAuth } from "../../../../shared/auth/user.auth";
import { AuthRequest } from "../../../../shared/types/auth.type";

import {
  assertDatasetExists,
  assertDatasetCount,
  assertValidParam,
} from "../../../../shared/utils/error.util";

/** Collection routes (JWT required via {@link checkAuth}). */
const router = Router();

/**
 * Wraps an async Express handler so rejections are passed to `next`.
 */
function asyncHandler(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthRequest, res, next).catch(next);
  };
}

router.use(checkAuth);

/** `POST /datasets` — create dataset. */
router.post(
  "/datasets",
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;

    if (!assertValidParam(res, "name", name)) return;

    res.status(201).json(
      await createDataset(req.userId, {
        name,
        description: typeof description === "string" ? description : undefined,
      }),
    );
  }),
);

/** `PUT /datasets/:datasetId` — update metadata. */
router.put(
  "/datasets/:datasetId",
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;

    const dataset = updateDataset(req.userId, req.params.datasetId as string, {
      name,
      description,
    });
    const resolved = await dataset;

    if (!assertDatasetExists(res, resolved)) return;

    res.status(200).json(resolved);
  }),
);

/** `DELETE /datasets/:datasetId` */
router.delete(
  "/datasets/:datasetId",
  asyncHandler(async (req, res) => {
    const count = await deleteDataset(req.userId, req.params.datasetId as string);
    if (!assertDatasetCount(res, count)) return;
    res.status(200).json({ count });
  }),
);

/** `PUT /datasets/:datasetId/events` — fetch Yahoo data and merge. */
router.put(
  "/datasets/:datasetId/events",
  asyncHandler(async (req, res) => {
    const { symbols, exchange, date_from, date_to } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      res.status(400).json({ error: "INVALID_PARAMETERS", message: "symbols must be a non-empty array." });
      return;
    }
    if (typeof exchange !== "string" || exchange.trim().length === 0) {
      res.status(400).json({ error: "INVALID_PARAMETERS", message: "exchange is required (e.g. \"XNAS\")." });
      return;
    }
    const dotted = symbols.find((s: unknown) => typeof s === "string" && s.includes("."));
    if (dotted) {
      res.status(400).json({
        error: "INVALID_PARAMETERS",
        message: `Symbol "${dotted}" must be a bare ticker (no dots). Use the exchange field instead.`,
      });
      return;
    }

    const result = await fetchEvents(
      req.userId,
      req.params.datasetId as string,
      { symbols, exchange: exchange.trim(), date_from, date_to },
    );

    if (!result) {
      res
        .status(404)
        .json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
      return;
    }

    res.status(200).json(result);
  }),
);

/** `DELETE /datasets/:datasetId/events` — remove events by filter. */
router.delete(
  "/datasets/:datasetId/events",
  asyncHandler(async (req, res) => {
    const { symbols, date_from, date_to } = req.body;

    const result = removeEvents(req.userId, req.params.datasetId as string, {
      symbols,
      date_from,
      date_to,
    });
    const resolved = await result;

    if (!resolved) {
      res
        .status(404)
        .json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
      return;
    }

    res.status(200).json(resolved);
  }),
);

router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("An error occurred:", err);
  res.status(500).json({ error: err.message });
});

export default router;
