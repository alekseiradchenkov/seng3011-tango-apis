import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import routes from "./routes";

export const app = express();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.use("/", routes);

app.use((req: Request, res: Response) => {
  res.status(404).send();
});

app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.status || 500).json({
    error: "INTERNAL",
    message: String(err?.message ?? err),
  });
});

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.log(`Auth service running on http://localhost:${port}`);
  });
}

