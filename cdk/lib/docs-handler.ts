import express from "express";
import serverlessExpress from "@vendia/serverless-express";
import swaggerUi from "swagger-ui-express";
import * as path from "path";
import * as fs from "fs";

const app = express();

const specPath = path.resolve(__dirname, "swagger.json");
let spec: object = {};
try {
  spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
} catch {
  console.warn("swagger.json not found, using empty spec");
}

app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));

app.get("/status", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use((_req, res) => res.status(404).json({ error: "NOT_FOUND" }));

export const handler = serverlessExpress({ app });
