import { Request, Response, Router } from "express";
import * as swaggerui from "swagger-ui-express";
import * as yaml from "yamljs";
import * as path from "path";

const router = Router();

let swaggerDoc: Record<string, unknown> | null = null;
for (const candidate of [
  path.resolve(__dirname, "swagger.yaml"),
  path.resolve(__dirname, "../../swagger.yaml"),
]) {
  try {
    swaggerDoc = yaml.load(candidate) as Record<string, unknown>;
    if (swaggerDoc) break;
  } catch {
  }
}

router.use("/collection/docs", swaggerui.serve);
router.get("/collection/docs", swaggerui.setup(swaggerDoc ?? {}));

router.get("/collection/status", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
