import { Request, Response, Router } from "express";
import * as swaggerui from "swagger-ui-express";
import * as yaml from "yamljs";
import * as path from "path";

const router = Router();

let swaggerDoc: Record<string, unknown> | null = null;
try {
  swaggerDoc = yaml.load(path.resolve(__dirname, "../../swagger.yaml"));
} catch {
  swaggerDoc = null;
}

router.use("/retrieval/docs", swaggerui.serve);
router.get("/retrieval/docs", swaggerui.setup(swaggerDoc ?? {}));

router.get("/retrieval/status", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
