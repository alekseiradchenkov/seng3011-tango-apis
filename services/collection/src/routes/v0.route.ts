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
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      error: "UNREACHABLE",
      message: "Service is unreachable.",
    });
  }
});

export default router;
