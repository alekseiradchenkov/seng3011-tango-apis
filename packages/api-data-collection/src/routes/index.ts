import { Router } from "express";

import v0 from "./v0";
import v1 from "./v1";

const router = Router();

router.use("/v0", v0);
router.use("/v1", v1);

export default router;
