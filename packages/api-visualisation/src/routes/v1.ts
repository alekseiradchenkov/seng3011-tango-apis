import { Request, Response, Router } from "express";

const router = Router();

router.get("/events/summary", async (req: Request, res: Response) => {
  try {
    res.status(200).json("Retrieve events summary");
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.get("/events/trends", async (req: Request, res: Response) => {
  try {
    res.status(200).json("Retrieve trend events as an ADAGE dataset");
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.post("/charts", async (req: Request, res: Response) => {
  try {
    res.status(200).json("Create a new chart");
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.get("/charts", async (req: Request, res: Response) => {
  try {
    res.status(200).json("List all charts");
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.get("/charts/:chart_id", async (req: Request, res: Response) => {
  try {
    res.status(200).json(`Retrieve chart by ID ${req.params.chart_id}`);
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.delete("/charts/:chart_id", async (req: Request, res: Response) => {
  try {
    res.status(200).json(`Delete chart by ID ${req.params.chart_id}`);  
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

router.get("/charts/:chart_id/render", async (req: Request, res: Response) => {
  try {
    res.status(200).json(`Render chart by ID ${req.params.chart_id} as an interactive HTML page`);
  } catch (error) {
    console.error("An error ocurred:", error);
    res.status(500).json(error);
  }
});

export default router;
