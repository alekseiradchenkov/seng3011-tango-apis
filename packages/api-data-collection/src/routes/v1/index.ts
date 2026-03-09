import { Request, Response, Router } from "express";

const router = Router();

router.get("/datasets", async (req: Request, res: Response) => {
  try {
    res.status(200).json("List all datasets");
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.post("/datasets", async (req: Request, res: Response) => {
  try {
    res.status(200).json("Create a new dataset");
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.get("/datasets/:datasetId", async (req: Request, res: Response) => {
  try {
    res.status(200).json(`Get ${req.params.datasetId} dataset`);
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.put("/datasets/:datasetId", async (req: Request, res: Response) => {
  try {
    res.status(200).json(`Update ${req.params.datasetId} dataset`);
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.delete("/datasets/:datasetId", async (req: Request, res: Response) => {
  try {
    res.status(200).json(`Remove ${req.params.datasetId} dataset`);
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.post(
  "/datasets/:datasetId/events",
  async (req: Request, res: Response) => {
    try {
      res.status(200).json(`Fetch envents for ${req.params.datasetId} dataset`);
    } catch (error) {
      console.error("An error ocurred:", error);
      res.status(500).json(error);
    }
  },
);

router.delete(
  "/datasets/:datasetId/events",
  async (req: Request, res: Response) => {
    try {
      res.status(200).json(`Remove ${req.params.datasetId} dataset events`);
    } catch (error) {
      console.error("An error ocurred:", error);
      res.status(500).json(error);
    }
  },
);

export default router;
