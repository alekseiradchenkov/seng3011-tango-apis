import { Router } from "express";

<<<<<<< HEAD
import v0 from "./v0.route";
import v1 from "./v1.route";
=======
import v0 from "./v0";
>>>>>>> 7b71a8b46b21a16f78714aca7f76516f564b4b1c

const router = Router();

router.use("/v0", v0);
<<<<<<< HEAD
router.use("/v1", v1);

export default router;
=======

export default router;
>>>>>>> 7b71a8b46b21a16f78714aca7f76516f564b4b1c
