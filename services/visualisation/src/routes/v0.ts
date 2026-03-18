import { Request, Response, Router } from "express";
import * as swaggerui from "swagger-ui-express";
import * as yaml from "yamljs";
import * as path from "path";

const router = Router();

let swaggerDoc: any = null;
try {
  swaggerDoc = yaml.load(path.resolve(__dirname, "../../swagger.yaml"));
} catch {
  // In Lambda bundles (LocalStack/CDK), swagger.yaml may not be present.
  swaggerDoc = null;
}

router.use("/docs", swaggerui.serve);
router.get("/docs", swaggerui.setup(swaggerDoc ?? {}));

router.get("/status", async (req: Request, res: Response) => {
  try {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      error: "UNREACHABLE",
      message: "Service is unreachable.",
    });
  }
});

router.get("/events/summary", async (_req: Request, res: Response) => {
  res.status(200).json({
    dataset_id: null,
    sectors: [],
    companies: [],
    recent_trends: [],
  });
});

router.get("/events/trends", async (_req: Request, res: Response) => {
  res.status(200).json({
    event_count: 0,
    dataset: null,
  });
});

export default router;