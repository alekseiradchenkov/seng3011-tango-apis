import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import * as swaggerui from "swagger-ui-express";
import * as yaml from "yamljs";
import * as path from "path";

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

import { checkAuth } from "../../../shared/auth/user.auth";
import { AuthRequest } from "../../../shared/types/auth.type";
import { AdageData, AdageEvent } from "../../../shared/types/adage.type";

export const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function getAwsEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

function getDdbDocClient() {
  const endpoint = getAwsEndpoint();
  const ddb = new DynamoDBClient({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    endpoint,
  });
  return DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function getS3Client() {
  const endpoint = getAwsEndpoint();
  return new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    endpoint,
    forcePathStyle: true,
  });
}

function metaPk(userId: string) {
  return `USER#${userId}`;
}
function metaSk(datasetId: string) {
  return `DATASET#${datasetId}`;
}
function datasetS3Key(userId: string, datasetId: string) {
  return `datasets/${userId}/${datasetId}.json`;
}

async function s3ReadJson<T>(bucket: string, key: string): Promise<T | null> {
  const s3 = getS3Client();
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await out.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function parseEventTime(event: AdageEvent): number {
  const raw = event.time_object?.timestamp;
  if (!raw) return Number.NaN;
  // Stored as "YYYY-MM-DD HH:mm:ss" (no timezone) in collection.
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const ms = Date.parse(iso);
  return ms;
}

function parseDateQuery(v: unknown): number | null {
  if (typeof v !== "string" || v.length === 0) return null;
  // swagger says format: date (YYYY-MM-DD)
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function csv(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      const s = v === null || v === undefined ? "" : String(v);
      if (s.includes('"') || s.includes(",") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(",");
}

function filterEvents(events: AdageEvent[], req: Request): AdageEvent[] {
  const startMs = parseDateQuery(req.query.start_date);
  const endMs = parseDateQuery(req.query.end_date);
  const companies =
    typeof req.query.companies === "string"
      ? req.query.companies.split(",").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(req.query.companies)
        ? req.query.companies.map(String)
        : [];
  const eventType = typeof req.query.event_type === "string" ? req.query.event_type : null;

  return events.filter((e) => {
    const t = parseEventTime(e);
    if (startMs !== null && !(t >= startMs)) return false;
    if (endMs !== null && !(t <= endMs + 24 * 60 * 60 * 1000 - 1)) return false;
    if (eventType && e.event_type !== eventType) return false;

    if (companies.length > 0) {
      const symbol = (e.attribute?.symbol as string | undefined) ?? "";
      const name = (e.attribute?.name as string | undefined) ?? "";
      const matches = companies.some(
        (c) => symbol.includes(c) || name.toLowerCase().includes(c.toLowerCase()),
      );
      if (!matches) return false;
    }
    return true;
  });
}

function sortAndLimit(events: AdageEvent[], req: Request): AdageEvent[] {
  const sortField = typeof req.query.sort === "string" ? req.query.sort : "time";
  const order = typeof req.query.order === "string" ? req.query.order : "DESC";
  const limit =
    typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 100;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 100;

  const sorted =
    sortField === "time"
      ? [...events].sort((a, b) => parseEventTime(a) - parseEventTime(b))
      : [...events];

  if (order.toUpperCase() === "DESC") sorted.reverse();
  return sorted.slice(0, safeLimit);
}

let swaggerDoc: any = null;
try {
  swaggerDoc = yaml.load(path.resolve(__dirname, "../swagger.yaml"));
} catch {
  swaggerDoc = null;
}

app.use("/v0/docs", swaggerui.serve);
app.get("/v0/docs", swaggerui.setup(swaggerDoc ?? {}));

app.get("/v0/status", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Authenticated routes (with local bypass support)
app.use("/v1", checkAuth);

app.get("/v1/datasets", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).userId;
    const table = requireEnv("EVENT_INDEX_TABLE");
    const ddb = getDdbDocClient();

    const out = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": metaPk(userId),
          ":skPrefix": "DATASET#",
        },
      }),
    );

    const items = (out.Items ?? []).map((i: any) => ({
      dataset_id: i.dataset_id,
      name: i.name,
      description: i.description,
      data_source: i.data_source,
      dataset_type: i.dataset_type,
      time_object: i.time_object,
      events: [],
    }));

    res.status(200).json(items);
  } catch (e) {
    next(e);
  }
});

app.get(
  "/v1/datasets/:datasetId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as AuthRequest).userId;
      const datasetId = req.params.datasetId as string;
      const table = requireEnv("EVENT_INDEX_TABLE");
      const eventsBucket = requireEnv("EVENTS_BUCKET");
      const ddb = getDdbDocClient();

      const metaOut = await ddb.send(
        new GetCommand({
          TableName: table,
          Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
        }),
      );
      if (!metaOut.Item) {
        res
          .status(404)
          .json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
        return;
      }
      const meta: any = metaOut.Item;
      const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
      const events = full?.events ?? [];
      res.status(200).json({
        dataset_id: meta.dataset_id,
        name: meta.name,
        description: meta.description,
        data_source: meta.data_source,
        dataset_type: meta.dataset_type,
        time_object: meta.time_object,
        events: events.slice(0, 100),
      });
    } catch (e) {
      next(e);
    }
  },
);

app.get(
  "/v1/datasets/:datasetId/events",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as AuthRequest).userId;
      const datasetId = req.params.datasetId as string;
      const table = requireEnv("EVENT_INDEX_TABLE");
      const eventsBucket = requireEnv("EVENTS_BUCKET");
      const ddb = getDdbDocClient();

      const metaOut = await ddb.send(
        new GetCommand({
          TableName: table,
          Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
        }),
      );
      if (!metaOut.Item) {
        res
          .status(404)
          .json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
        return;
      }

      const meta: any = metaOut.Item;
      const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
      const events = full?.events ?? [];

      const filtered = filterEvents(events, req);
      const outEvents = sortAndLimit(filtered, req);

      res.status(200).json({
        retrieved: outEvents.length,
        dataset: {
          dataset_id: meta.dataset_id,
          name: meta.name,
          description: meta.description,
          data_source: meta.data_source,
          dataset_type: meta.dataset_type,
          time_object: meta.time_object,
          events: outEvents,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

app.get(
  "/v1/datasets/:datasetId/events/stats",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as AuthRequest).userId;
      const datasetId = req.params.datasetId as string;
      const table = requireEnv("EVENT_INDEX_TABLE");
      const eventsBucket = requireEnv("EVENTS_BUCKET");
      const ddb = getDdbDocClient();

      const metaOut = await ddb.send(
        new GetCommand({
          TableName: table,
          Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
        }),
      );
      if (!metaOut.Item) {
        res
          .status(404)
          .json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
        return;
      }

      const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
      const events = full?.events ?? [];
      const filtered = filterEvents(events, req);

      const event_type_counts: Record<string, number> = {};
      for (const e of filtered) {
        event_type_counts[e.event_type] = (event_type_counts[e.event_type] ?? 0) + 1;
      }

      res.status(200).json({
        total_events: filtered.length,
        event_type_counts,
      });
    } catch (e) {
      next(e);
    }
  },
);

app.get(
  "/v1/datasets/:datasetId/export",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as AuthRequest).userId;
      const datasetId = req.params.datasetId as string;
      const table = requireEnv("EVENT_INDEX_TABLE");
      const eventsBucket = requireEnv("EVENTS_BUCKET");
      const ddb = getDdbDocClient();

      const metaOut = await ddb.send(
        new GetCommand({
          TableName: table,
          Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
        }),
      );
      if (!metaOut.Item) {
        res
          .status(404)
          .json({ error: "DATASET_NOT_FOUND", message: "Invalid dataset id." });
        return;
      }

      const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
      const events = full?.events ?? [];
      const filtered = sortAndLimit(filterEvents(events, req), req);

      const lines = [
        "symbol,open,high,low,close,volume,timestamp",
        ...filtered.map((e) =>
          csv([
            e.attribute?.symbol as any,
            e.attribute?.open as any,
            e.attribute?.high as any,
            e.attribute?.low as any,
            e.attribute?.close as any,
            e.attribute?.volume as any,
            e.time_object?.timestamp as any,
          ]),
        ),
      ];

      res.status(200).type("text/csv").send(lines.join("\n") + "\n");
    } catch (e) {
      next(e);
    }
  },
);

app.use((req: Request, res: Response) => {
  res.status(404).send();
});

app.use(
  (err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "INTERNAL", message: String(err?.message ?? err) });
  },
);

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
app.listen(port, () => {
  console.log(`Server listening at port: ${port}`);
});
}
