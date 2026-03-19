import express from "express";
import routes from "./routes";

export const app = express();

app.use(express.json());

app.use("/", routes);

app.use(
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.status(404).send();
  },
);

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.status(err.status || 500).send();
  },
);

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}
