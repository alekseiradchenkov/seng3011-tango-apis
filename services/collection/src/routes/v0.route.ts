import { Request, Response, Router } from "express";
import * as swaggerui from "swagger-ui-express";
import * as yaml from "yamljs";
import * as path from "path";

const router = Router();

let swaggerDoc: Record<string, unknown> | null = null;
try {
  swaggerDoc = yaml.load(path.resolve(__dirname, "../../swagger.yaml"));
} catch {
  // In Lambda bundles (LocalStack/CDK), swagger.yaml may not be present.
  swaggerDoc = null;
}

router.use("/collection/docs", swaggerui.serve);
router.get("/collection/docs", swaggerui.setup(swaggerDoc ?? {}));

router.get("/collection/status", async (_req: Request, res: Response) => {
  try {
    res.status(200).json({ timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ error: "UNREACHABLE", message: "Service is unreachable." });
  }
});

export default router;
