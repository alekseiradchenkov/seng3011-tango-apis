import { Router } from "express";
import v1 from "./v1.route";

const router = Router();

router.use("/auth", v1);

export default router;

