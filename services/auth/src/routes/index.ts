import { Router } from "express";
import v1 from "./v1.route";

/** Top-level router; mounts auth routes under `/auth`. */
const router = Router();

router.use("/auth", v1);

export default router;

