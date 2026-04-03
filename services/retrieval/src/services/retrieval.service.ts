/**
 * Retrieval service: read-only dataset and event access (DynamoDB metadata + S3 payloads).
 *
 * @remarks Mutations belong to the Collection service only.
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

import { AdageData, AdageEvent } from "../../../../shared/types/adage.type";

/** @throws Error if unset. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

/** Optional LocalStack / custom endpoint. */
function getAwsEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

/** DynamoDB DocumentClient. */
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

/** S3 client (path-style for LocalStack). */
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

/** S3 object key for dataset JSON. */
export function datasetS3Key(userId: string, datasetId: string) {
  return `datasets/${userId}/${datasetId}.json`;
}

/**
 * Reads JSON from S3; returns `null` on missing or unreadable objects.
 */
export async function s3ReadJson<T>(bucket: string, key: string): Promise<T | null> {
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

/**
 * Parses an event timestamp to epoch ms (ISO or space-separated Yahoo-style).
 */
export function parseEventTime(event: AdageEvent): number {
  const raw = event.time_object?.timestamp;
  if (!raw) return Number.NaN;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  return Date.parse(iso);
}

/**
 * Parses `YYYY-MM-DD` query values to start-of-day UTC ms, or `null`.
 */
export function parseDateQuery(v: unknown): number | null {
  if (typeof v !== "string" || v.length === 0) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** RFC 4180 CSV row from values. */
export function csv(values: (string | number | null | undefined)[]): string {
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

export interface EventQueryParams {
  start_date?: unknown;
  end_date?: unknown;
  companies?: unknown;
  event_type?: unknown;
  sort?: unknown;
  order?: unknown;
  limit?: unknown;
}

/** Applies date, company, and `event_type` filters. */
export function filterEvents(events: AdageEvent[], params: EventQueryParams): AdageEvent[] {
  const startMs = parseDateQuery(params.start_date);
  const endMs = parseDateQuery(params.end_date);

  const companies =
    typeof params.companies === "string"
      ? params.companies.split(",").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(params.companies)
        ? params.companies.map(String)
        : [];
  const eventType = typeof params.event_type === "string" ? params.event_type : null;

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

/** Sorts (default by time) and caps results (max 1000). */
export function sortAndLimit(events: AdageEvent[], params: EventQueryParams): AdageEvent[] {
  const sortField = typeof params.sort === "string" ? params.sort : "time";
  const order = typeof params.order === "string" ? params.order : "DESC";
  const limit =
    typeof params.limit === "string" ? Number.parseInt(params.limit, 10) : 100;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 100;

  const sorted =
    sortField === "time"
      ? [...events].sort((a, b) => parseEventTime(a) - parseEventTime(b))
      : [...events];

  if (order.toUpperCase() === "DESC") sorted.reverse();
  return sorted.slice(0, safeLimit);
}

/**
 * Lists dataset metadata rows for a user (no events).
 */
export async function getDatasets(userId: string): Promise<Record<string, unknown>[]> {
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

  return (out.Items ?? []).map((i: Record<string, unknown>) => ({
    dataset_id: i.dataset_id,
    name: i.name,
    description: i.description,
    data_source: i.data_source,
    dataset_type: i.dataset_type,
    time_object: i.time_object,
  }));
}

/**
 * Single dataset metadata (no events); `null` if missing.
 */
export async function getDataset(
  userId: string,
  datasetId: string,
): Promise<Record<string, unknown> | null> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const ddb = getDdbDocClient();

  const metaOut = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
    }),
  );
  if (!metaOut.Item) return null;

  const meta = metaOut.Item as Record<string, unknown>;
  return {
    dataset_id: meta.dataset_id,
    name: meta.name,
    description: meta.description,
    data_source: meta.data_source,
    dataset_type: meta.dataset_type,
    time_object: meta.time_object,
  };
}

/**
 * Filtered/sorted events with metadata; `null` if dataset missing.
 */
export async function getEvents(
  userId: string,
  datasetId: string,
  params: EventQueryParams,
): Promise<{ retrieved: number; dataset: Record<string, unknown> } | null> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const eventsBucket = requireEnv("EVENTS_BUCKET");
  const ddb = getDdbDocClient();

  const metaOut = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
    }),
  );
  if (!metaOut.Item) return null;

  const meta = metaOut.Item as Record<string, unknown>;
  const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
  const filtered = filterEvents(full?.events ?? [], params);
  const outEvents = sortAndLimit(filtered, params);

  return {
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
  };
}

/**
 * Event counts by `event_type` after filters; `null` if dataset missing.
 */
export async function getEventStats(
  userId: string,
  datasetId: string,
  params: EventQueryParams,
): Promise<{ total_events: number; event_type_counts: Record<string, number> } | null> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const eventsBucket = requireEnv("EVENTS_BUCKET");
  const ddb = getDdbDocClient();

  const metaOut = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
    }),
  );
  if (!metaOut.Item) return null;

  const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
  const filtered = filterEvents(full?.events ?? [], params);

  const event_type_counts: Record<string, number> = {};
  for (const e of filtered) {
    event_type_counts[e.event_type] = (event_type_counts[e.event_type] ?? 0) + 1;
  }

  return { total_events: filtered.length, event_type_counts };
}

/**
 * CSV export of filtered OHLC rows; `null` if dataset missing.
 */
export async function exportEventsAsCsv(
  userId: string,
  datasetId: string,
  params: EventQueryParams,
): Promise<string | null> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const eventsBucket = requireEnv("EVENTS_BUCKET");
  const ddb = getDdbDocClient();

  const metaOut = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
    }),
  );
  if (!metaOut.Item) return null;

  const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
  const filtered = sortAndLimit(filterEvents(full?.events ?? [], params), params);

  const lines = [
    "symbol,open,high,low,close,volume,timestamp",
    ...filtered.map((e) =>
      csv([
        e.attribute?.symbol as string | undefined,
        e.attribute?.open as number | undefined,
        e.attribute?.high as number | undefined,
        e.attribute?.low as number | undefined,
        e.attribute?.close as number | undefined,
        e.attribute?.volume as number | undefined,
        e.time_object?.timestamp as string | undefined,
      ]),
    ),
  ];

  return lines.join("\n") + "\n";
}
