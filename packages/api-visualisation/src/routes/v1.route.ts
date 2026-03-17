import { Request, Response, Router, NextFunction } from "express";
import {
  createChart,
  deleteChart,
  getChart,
  getCharts,
  getEventsSummary,
  getEventTrends,
} from "../services/visualisation.service";

import { checkAuth } from "../../../../shared/auth/user.auth";
import { AuthRequest } from "../../../../shared/types/auth.type";

import {
  assertDatasetExists,
  assertDatasetCount,
  assertValidParam,
  assertChartCount,
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

router.get(
  "/events/summary",
  asyncHandler<AuthRequest>(async (req, res) => {
    res.status(200).json(getEventsSummary(req.userId));
  }),
);

router.get(
  "/events/trends",
  asyncHandler<AuthRequest>(async (req, res) => {
    res.status(200).json(getEventTrends({
      dataset_id: req.query.dataset_id as string,
      ...req.query
    }));
  }),
);

router.post(
  "/charts/",
  asyncHandler<AuthRequest>(async (req, res) => {
    const { type, dataset_id, x_axis, y_axis, title, series } = req.body;

    const result = await createChart(
      req.userId,
      { dataset_id, type, x_axis, y_axis, title, series }
    );

    if (!result) {
      res
        .status(400)
        .json({ error: "EVENT_VISUAL_INVALID_PARAMETERS", message: "time_period must be a positive integer." });
      return;
    }

    res.status(200).json(result);
  }),
);

router.get(
  "/charts",
  asyncHandler<AuthRequest>(async (req, res) => {
    const chart = getCharts(req.userId);
    res.status(200).json(chart);
  }),
);

router.get(
  "/charts/:chartId",
  asyncHandler<AuthRequest>(async (req, res) => {
    const chart = getChart(req.userId, req.params.chartId as string);
    if (!chart) {
      res.status(404).json({ error: "CHART_NOT_FOUND", message: "Invalid chart id." });
      return;
    }
    res.status(200).json(chart);
  }),
);


router.delete(
  "/charts/:chartId",
  asyncHandler<AuthRequest>(async (req, res) => {
    const deleted = deleteChart(req.userId, req.params.chartId as string);
    if (!assertChartCount(res, deleted)) return;
    res.status(200).json({ deleted });
  }),
);

router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("An error occurred:", err);
  res.status(500).json({ error: err.message });
});

export default router;