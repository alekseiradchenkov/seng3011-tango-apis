import { Request, Response, Router } from "express";
import * as swaggerui from "swagger-ui-express";
import * as yaml from "yamljs";
import * as path from "path";

const router = Router();

let swaggerDoc: any = null;
try {
  swaggerDoc = yaml.load(path.resolve(__dirname, "../../swagger.yaml"));
} catch {
  swaggerDoc = null;
}

router.use("/docs", swaggerui.serve);
router.get("/docs", swaggerui.setup(swaggerDoc ?? {}));

router.get("/status", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
