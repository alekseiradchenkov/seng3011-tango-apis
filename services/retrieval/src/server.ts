import express from "express";
import cors from "cors";
import morgan from "morgan";

import routes from "./routes";

export const app = express();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.use("/", routes);

app.use((_req: express.Request, res: express.Response) => {
  res.status(404).send();
});

app.use(
  (
    err: { status?: number; message?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(err.status ?? 500).json({ error: "INTERNAL", message: String(err?.message ?? err) });
  },
);

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}
