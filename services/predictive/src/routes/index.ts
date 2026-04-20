import { Router } from "express";

import predict from "./predict.route";

/** Predictive service root router. */
const router = Router();

router.use("/", predict);

export default router;

