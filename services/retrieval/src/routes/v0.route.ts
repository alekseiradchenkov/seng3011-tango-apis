import { Request, Response, Router } from "express";
import * as swaggerui from "swagger-ui-express";
import * as yaml from "yamljs";
import * as path from "path";

const router = Router();

let swaggerDoc: Record<string, unknown> | null = null;
// In Lambda the bundle is flat (__dirname = /var/task), so swagger.yaml lands
// alongside index.js. Locally __dirname is src/routes/, so go up two levels.
for (const candidate of [
  path.resolve(__dirname, "swagger.yaml"),
  path.resolve(__dirname, "../../swagger.yaml"),
]) {
  try {
    swaggerDoc = yaml.load(candidate) as Record<string, unknown>;
    if (swaggerDoc) break;
  } catch {
    // try next candidate
  }
}

router.use("/retrieval/docs", swaggerui.serve);
router.get("/retrieval/docs", swaggerui.setup(swaggerDoc ?? {}));

router.get("/retrieval/status", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
