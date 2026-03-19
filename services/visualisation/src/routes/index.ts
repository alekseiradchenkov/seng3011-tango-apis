import { Router } from "express";

import v0 from "./v0";

const router = Router();

router.use("/v0", v0);
// Minimal v1 support to match swagger + API Gateway routes
router.use("/v1", v0);

export default router;
