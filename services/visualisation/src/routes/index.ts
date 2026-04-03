import { Router } from "express";

import v1 from "./v1";

/** Visualisation root router. */
const router = Router();

router.use("/", v1);

export default router;
