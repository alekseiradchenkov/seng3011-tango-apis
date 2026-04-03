import { NextFunction, Request, Response, Router } from "express";

import { checkAuth } from "../../../../shared/auth/user.auth";
import { AuthRequest } from "../../../../shared/types/auth.type";
import {
  EventQueryParams,
  exportEventsAsCsv,
  getDataset,
  getDatasets,
  getEvents,
  getEventStats,
} from "../services/retrieval.service";

/** Read-only dataset/event routes (JWT required). */
const router = Router();

/** Express async wrapper forwarding to `next` on rejection. */
function asyncHandler(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthRequest, res, next).catch(next);
  };
}

router.use(checkAuth);

/** `GET /datasets` */
router.get(
  "/datasets",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getDatasets(req.userId));
  }),
);

/** `GET /datasets/:datasetId` */
router.get(
  "/datasets/:datasetId",
  asyncHandler(async (req, res) => {
    const result = await getDataset(req.userId, req.params.datasetId as string);
    if (!result) {
      res.status(404).json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
      return;
    }
    res.status(200).json(result);
  }),
);

/** `GET /datasets/:datasetId/events` */
router.get(
  "/datasets/:datasetId/events",
  asyncHandler(async (req, res) => {
    const params: EventQueryParams = req.query;
    const result = await getEvents(req.userId, req.params.datasetId as string, params);
    if (!result) {
      res.status(404).json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
      return;
    }
    res.status(200).json(result);
  }),
);

/** `GET /datasets/:datasetId/events/stats` */
router.get(
  "/datasets/:datasetId/events/stats",
  asyncHandler(async (req, res) => {
    const params: EventQueryParams = req.query;
    const result = await getEventStats(req.userId, req.params.datasetId as string, params);
    if (!result) {
      res.status(404).json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
      return;
    }
    res.status(200).json(result);
  }),
);

/** `GET /datasets/:datasetId/export` */
router.get(
  "/datasets/:datasetId/export",
  asyncHandler(async (req, res) => {
    const params: EventQueryParams = req.query;
    const csvData = await exportEventsAsCsv(req.userId, req.params.datasetId as string, params);
    if (csvData === null) {
      res.status(404).json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
      return;
    }
    res.status(200).type("text/csv").send(csvData);
  }),
);

router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("An error occurred:", err);
  res.status(500).json({ error: "INTERNAL", message: String(err?.message ?? err) });
});

export default router;
