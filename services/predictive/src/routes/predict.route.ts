import { NextFunction, Request, Response, Router } from "express";

import { checkAuth } from "../../../../shared/auth/user.auth";
import { AuthRequest } from "../../../../shared/types/auth.type";
import { getElectricityShock, getMacroSummary, runPrediction, trainModel } from "../services/predict.service";

/** Predictive endpoints (JWT required). */
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

/** `POST /predict/models/train` */
router.post(
  "/predict/models/train",
  asyncHandler(async (req, res) => {
    res.status(200).json(await trainModel(req.userId, req.body as unknown));
  }),
);

/** `POST /predict/run` */
router.post(
  "/predict/run",
  asyncHandler(async (req, res) => {
    res.status(200).json(await runPrediction(req.userId, req.body as unknown));
  }),
);

/** `GET /predict/electricity-shock` */
router.get(
  "/predict/electricity-shock",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await getElectricityShock());
  }),
);

/** `GET /predict/macro-summary` */
router.get(
  "/predict/macro-summary",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await getMacroSummary());
  }),
);

router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("An error occurred:", err);
  res.status(500).json({ error: "INTERNAL", message: String(err?.message ?? err) });
});

export default router;

