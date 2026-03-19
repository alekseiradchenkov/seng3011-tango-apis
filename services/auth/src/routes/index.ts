import { Router } from "express";
import v0 from "./v0.route";
import v1 from "./v1.route";

const router = Router();

router.use("/v0", v0);
router.use("/v1/auth", v1);

export default router;

