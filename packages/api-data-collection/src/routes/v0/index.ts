import { Request, Response, Router } from "express";
import * as swaggerui from "swagger-ui-express";
import * as yaml from "yamljs";
import * as path from "path";

const router = Router();

const swaggerDocument = yaml.load(
  path.resolve(__dirname, "../../../swagger.yaml"),
);

router.use("/docs", swaggerui.serve);
router.get("/docs", swaggerui.setup(swaggerDocument));

router.get("/status", async (req: Request, res: Response) => {
  try {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

export default router;
