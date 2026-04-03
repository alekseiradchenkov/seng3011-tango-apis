import { Router } from "express";

import v1 from "./v1.route";

/** Root router for the Collection service. */
const router = Router();

router.use("/", v1);

export default router;
