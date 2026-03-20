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

const router = Router();

function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as T, res, next).catch(next);
  };
}

/* Get and verify userId (see ../../../../shared/auth/user.auth) */
router.use(checkAuth);

router.post(
  "/datasets",
  asyncHandler<AuthRequest>(async (req, res) => {
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

router.put(
  "/datasets/:datasetId",
  asyncHandler<AuthRequest>(async (req, res) => {
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

router.delete(
  "/datasets/:datasetId",
  asyncHandler<AuthRequest>(async (req, res) => {
    const count = await deleteDataset(req.userId, req.params.datasetId as string);
    if (!assertDatasetCount(res, count)) return;
    res.status(200).json({ count });
  }),
);

router.put(
  "/datasets/:datasetId/events",
  asyncHandler<AuthRequest>(async (req, res) => {
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

router.delete(
  "/datasets/:datasetId/events",
  asyncHandler<AuthRequest>(async (req, res) => {
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
