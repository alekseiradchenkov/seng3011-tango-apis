// datasets.service.ts

// Core business logic for the Collection service.
// Handles creating, reading, updating, and deleting datasets, as well as
// fetching and removing events within a dataset.

// Storage layout:
  // DynamoDB (EVENT_INDEX_TABLE): stores lightweight dataset metadata
  // using a composite key of PK = "USER#<userId>" and SK = "DATASET#<datasetId>".
  // S3 (EVENTS_BUCKET): stores the full ADAGE-format event payload as JSON
  // at "datasets/<userId>/<datasetId>.json".

// This two-store design keeps DynamoDB lean (fast list queries) while S3
// handles the large event payloads cheaply.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

import { AdageData, AdageEvent } from "../../../../shared/types/adage.type";
import { DatasetFilters, DatasetMetadata } from "../../../../shared/types/db.type";
import {
  DatasetCreateInput,
  FetchEventsInput,
  RemoveEventsFilter,
} from "../../../../shared/types/datasets.type";
import { nowTimeObject } from "../../../../shared/utils/time.util";
import { getYahooEod } from "./yahoo.service";


// ENVIRONMENT + AWS CLIENT HELPERS

// Reads a required environment variable and throws a descriptive error if missing.
// Ensures the Lambda fails fast at invocation time rather than silently misbehaving.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

// Resolves the AWS endpoint URL for local development and CI.
  // AWS_ENDPOINT_URL: explicitly set custom endpoint (e.g. in GitHub Actions).
  // LOCALSTACK_HOSTNAME: set automatically by LocalStack docker-compose.
  // undefined: fall through to real AWS regional endpoint in production.
function getAwsEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

// Creates a DynamoDB Document client configured for the current environment.
// removeUndefinedValues prevents DynamoDB from rejecting items with undefined fields.
function getDdbDocClient() {
  const endpoint = getAwsEndpoint();
  const ddb = new DynamoDBClient({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    endpoint,
  });
  return DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });
}

// Creates an S3 client configured for the current environment.
// forcePathStyle is required for LocalStack which does not support virtual-hosted-style URLs.
function getS3Client() {
  const endpoint = getAwsEndpoint();
  return new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    endpoint,
    forcePathStyle: true,
  });
}

// DYANMO_DB KEY HELPERS

// Returns the DynamoDB partition key for a user's records.
function metaPk(userId: string) {
  return `USER#${userId}`;
}

// Returns the DynamoDB sort key for a specific dataset record.
function metaSk(datasetId: string) {
  return `DATASET#${datasetId}`;
}

//  Returns the S3 object key for a dataset's full event payload.
// Namespaced by userId to keep each user's data isolated in the bucket.
function datasetS3Key(userId: string, datasetId: string) {
  return `datasets/${userId}/${datasetId}.json`;
}

// S3 HELPERS

// Reads and parses a JSON object from S3.
  // Returns null if the object does not exist (NoSuchKey) or the body is empty.
  // All other S3 errors are also swallowed and return null to avoid crashing callers.
async function s3ReadJson<T>(bucket: string, key: string): Promise<T | null> {
  const s3 = getS3Client();
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await out.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as T;
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === "NoSuchKey") return null;
    return null;
  }
}
// Serialises a value as JSON and writes it to an S3 object.
// Overwrites any existing object at the same key (last-write-wins).
async function s3WriteJson(bucket: string, key: string, value: unknown) {
  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    }),
  );
}

// DATA SHAPE HELPERS

// Constructs an AdageData response object from stored metadata and a list of events.
// Only includes optional fields (name, description) when they are defined to keep
// the response clean and avoid sending null values to consumers.
function toAdageData(meta: DatasetMetadata, events: AdageEvent[]): AdageData {
  return {
    data_source: meta.data_source,
    dataset_type: meta.dataset_type,
    dataset_id: meta.dataset_id,
    time_object: meta.time_object,
    ...(meta.name !== undefined ? { name: meta.name } : {}),
    ...(meta.description !== undefined ? { description: meta.description } : {}),
    events,
  };
}

// EXPORTED SERVICE FUNCTIONS

function parseEventTimeMs(event: AdageEvent): number {
  const raw = event.time_object?.timestamp ?? "";
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function movingAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

type DerivationSummary = {
  derivedEvents: AdageEvent[];
  eventTypeCounts: Record<string, number>;
};

function deriveEvents(rawEvents: AdageEvent[]): DerivationSummary {
  const derivedEvents: AdageEvent[] = [];
  const eventTypeCounts: Record<string, number> = {};

  const bySymbol = new Map<string, AdageEvent[]>();
  for (const event of rawEvents) {
    const symbol = String(event.attribute?.symbol ?? "");
    if (!symbol) continue;
    const arr = bySymbol.get(symbol) ?? [];
    arr.push(event);
    bySymbol.set(symbol, arr);
  }

  for (const [symbol, events] of bySymbol.entries()) {
    events.sort((a, b) => parseEventTimeMs(a) - parseEventTimeMs(b));
    const closes = events.map((e) => asNumber(e.attribute?.close));

    for (let i = 1; i < events.length; i += 1) {
      const prev = closes[i - 1];
      const curr = closes[i];
      if (prev === null || curr === null || prev === 0) continue;
      const pct = ((curr - prev) / prev) * 100;
      if (pct >= 5 || pct <= -5) {
        const eventType = pct >= 5 ? "price_jump" : "price_drop";
        derivedEvents.push({
          time_object: events[i].time_object,
          event_type: eventType,
          attribute: {
            symbol,
            pct_change_1d: Number(pct.toFixed(4)),
            close_today: curr,
            close_prev: prev,
            threshold: 5,
            rule_engine_version: "1.0.0",
          },
        });
        eventTypeCounts[eventType] = (eventTypeCounts[eventType] ?? 0) + 1;
      }
    }

    // Volatility spike: stdev(10) > stdev(30) * 1.5
    for (let i = 29; i < events.length; i += 1) {
      const window30 = closes.slice(i - 29, i + 1).filter((v): v is number => v !== null);
      const window10 = closes.slice(i - 9, i + 1).filter((v): v is number => v !== null);
      if (window30.length < 30 || window10.length < 10) continue;
      const stdev30 = stddev(window30);
      const stdev10 = stddev(window10);
      const factor = stdev30 === 0 ? 0 : stdev10 / stdev30;
      if (factor > 1.5) {
        derivedEvents.push({
          time_object: events[i].time_object,
          event_type: "volatility_spike",
          attribute: {
            symbol,
            stdev_10: Number(stdev10.toFixed(6)),
            stdev_30: Number(stdev30.toFixed(6)),
            spike_factor: Number(factor.toFixed(6)),
            threshold_factor: 1.5,
            rule_engine_version: "1.0.0",
          },
        });
        eventTypeCounts.volatility_spike = (eventTypeCounts.volatility_spike ?? 0) + 1;
      }
    }

    // Trend crossover: MA20 crossing MA50
    for (let i = 50; i < events.length; i += 1) {
      const shortNowSlice = closes.slice(i - 19, i + 1).filter((v): v is number => v !== null);
      const longNowSlice = closes.slice(i - 49, i + 1).filter((v): v is number => v !== null);
      const shortPrevSlice = closes.slice(i - 20, i).filter((v): v is number => v !== null);
      const longPrevSlice = closes.slice(i - 50, i).filter((v): v is number => v !== null);
      if (
        shortNowSlice.length < 20 ||
        longNowSlice.length < 50 ||
        shortPrevSlice.length < 20 ||
        longPrevSlice.length < 50
      ) {
        continue;
      }
      const shortNow = movingAverage(shortNowSlice);
      const longNow = movingAverage(longNowSlice);
      const shortPrev = movingAverage(shortPrevSlice);
      const longPrev = movingAverage(longPrevSlice);
      const prevDelta = shortPrev - longPrev;
      const nowDelta = shortNow - longNow;
      const crossedUp = prevDelta <= 0 && nowDelta > 0;
      const crossedDown = prevDelta >= 0 && nowDelta < 0;
      if (crossedUp || crossedDown) {
        derivedEvents.push({
          time_object: events[i].time_object,
          event_type: "trend_crossover",
          attribute: {
            symbol,
            short_window: 20,
            long_window: 50,
            ma_short: Number(shortNow.toFixed(6)),
            ma_long: Number(longNow.toFixed(6)),
            direction: crossedUp ? "bullish" : "bearish",
            rule_engine_version: "1.0.0",
          },
        });
        eventTypeCounts.trend_crossover = (eventTypeCounts.trend_crossover ?? 0) + 1;
      }
    }
  }

  return { derivedEvents, eventTypeCounts };
}

// Returns all datasets belonging to a user (metadata only, no events).
// Queries DynamoDB using the user's partition key to list all DATASET# sort keys.
export async function getDatasets(userId: string): Promise<AdageData[]> {
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

  return (out.Items ?? []).map((i: Record<string, unknown>) =>
    toAdageData(i as DatasetMetadata, []),
  );
}

// Creates a new empty dataset for a user.
// Generates a unique datasetId, writes metadata to DynamoDB, and creates
// an empty ADAGE-format JSON file in S3 to hold future events.
export async function createDataset(
  userId: string,
  input: DatasetCreateInput,
): Promise<AdageData> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const eventsBucket = requireEnv("EVENTS_BUCKET");
  const ddb = getDdbDocClient();

  // Generate a unique dataset ID using timestamp + random hex suffix.
  const datasetId = `dataset_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const meta: DatasetMetadata = {
    data_source: "YahooFinance",
    dataset_type: "daily_stock_ohlc_data",
    dataset_id: datasetId,
    time_object: nowTimeObject(),
    user_id: userId,
    name: input.name,
    description: input.description,
    filters: {},
  };

  // Write metadata to DynamoDB.
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: metaPk(userId),
        SK: metaSk(datasetId),
        ...meta,
      },
    }),
  );

  // Create an empty dataset file in S3 so future event fetches have a base to append to.
  const adageData = toAdageData(meta, []);
  await s3WriteJson(eventsBucket, datasetS3Key(userId, datasetId), adageData);

  return adageData;
}

// Retrieves a single dataset including its first 100 events.
// The 100-event cap prevents Lambda timeouts on large datasets;
// callers needing more events should use the events endpoint with pagination.
// Returns null if the dataset does not exist or does not belong to this user.
export async function getDataset(
  userId: string,
  datasetId: string,
): Promise<AdageData | null> {
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
  const meta = metaOut.Item as unknown as DatasetMetadata;

  const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
  const events = full?.events ?? [];
  return toAdageData(meta, events.slice(0, 100));
}

// Updates the name and/or description of an existing dataset.
// Also updates the time_object to reflect the modification timestamp.
// Returns null if the dataset does not exist.
export async function updateDataset(
  userId: string,
  datasetId: string,
  input: DatasetCreateInput,
): Promise<AdageData | null> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const ddb = getDdbDocClient();

  const out = await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
      UpdateExpression:
        "SET #t = :t" +
        (input.name ? ", #n = :n" : "") +
        (typeof input.description === "string" ? ", #d = :d" : ""),
      ExpressionAttributeNames: {
        "#t": "time_object",
        "#n": "name",
        "#d": "description",
      },
      ExpressionAttributeValues: {
        ":t": nowTimeObject(),
        ...(input.name ? { ":n": input.name } : {}),
        ...(typeof input.description === "string" ? { ":d": input.description } : {}),
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  if (!out.Attributes) return null;
  return toAdageData(out.Attributes as unknown as DatasetMetadata, []);
}

// Deletes a dataset's DynamoDB metadata record.
// The S3 event payload is replaced with a tombstone marker rather than deleted
// (best-effort soft-delete) so data is not permanently lost on accidental delete.
// Returns 1 if deleted, 0 if the dataset was not found.
export async function deleteDataset(userId: string, datasetId: string): Promise<number> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const eventsBucket = requireEnv("EVENTS_BUCKET");
  const ddb = getDdbDocClient();

  const existing = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
    }),
  );
  if (!existing.Item) return 0;

  await ddb.send(
    new DeleteCommand({
      TableName: table,
      Key: { PK: metaPk(userId), SK: metaSk(datasetId) },
    }),
  );

  // Best-effort: leave orphaned S3 object if delete not supported/desired.
  await s3WriteJson(eventsBucket, datasetS3Key(userId, datasetId), { deleted: true });
  return 1;
}

// Fetches OHLC events from Yahoo Finance and appends them to an existing dataset.
// Symbols are converted from ADAGE format (e.g. "AAPL.XNAS") to bare tickers
// ("AAPL") before calling Yahoo, then restored to the original format in the output.

// Existing events are preserved; new events are merged and deduplicated by timestamp+symbol.
// Returns null if the dataset does not exist.
export async function fetchEvents(
  userId: string,
  datasetId: string,
  query: FetchEventsInput,
): Promise<{
  count: number;
  raw_event_count: number;
  derived_event_count: number;
  event_type_counts: Record<string, number>;
  dataset: AdageData;
} | null> {
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
  const meta = metaOut.Item as unknown as DatasetMetadata;

  // Build fully-qualified ADAGE symbols: "AAPL" + "XNAS" → "AAPL.XNAS"
  const qualifiedSymbols = (query.symbols ?? []).map((sym) => `${sym}.${query.exchange}`);

  // Strict mode: no fake fallback. If Yahoo fails, the request fails.
  const events = await getYahooEod({
    symbols: qualifiedSymbols,
    date_from: query.date_from,
    date_to: query.date_to,
  });
  const { derivedEvents, eventTypeCounts } = deriveEvents(events);
  const allEvents = [...events, ...derivedEvents].sort((a, b) => parseEventTimeMs(a) - parseEventTimeMs(b));

  const newFilters: DatasetFilters = {
    symbols: query.symbols,
    exchange: query.exchange,
    ...(query.date_from ? { date_from: query.date_from } : {}),
    ...(query.date_to ? { date_to: query.date_to } : {}),
  };

  meta.time_object = nowTimeObject();
  meta.filters = newFilters;

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: metaPk(userId),
        SK: metaSk(datasetId),
        ...meta,
      },
    }),
  );

  const full = toAdageData(meta, allEvents);
  await s3WriteJson(eventsBucket, datasetS3Key(userId, datasetId), full);

  const fullEventTypeCounts: Record<string, number> = {
    stock_ohlc: events.length,
    ...eventTypeCounts,
  };

  return {
    count: allEvents.length,
    raw_event_count: events.length,
    derived_event_count: derivedEvents.length,
    event_type_counts: fullEventTypeCounts,
    dataset: toAdageData(meta, allEvents.slice(0, 100)),
  };
}

// Removes events from a dataset based on optional symbol and date-range filters.
// Reads the full event list from S3, filters out matching events, and writes back.
// Returns null if the dataset does not exist.
export async function removeEvents(
  userId: string,
  datasetId: string,
  query?: RemoveEventsFilter,
): Promise<{ count: number } | null> {
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
  const meta = metaOut.Item as unknown as DatasetMetadata;

  const full = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, datasetId));
  const events = full?.events ?? [];
  const countBefore = events.length;

  const newEvents = events.filter((i) => {
    if (!query) return false; // remove all when no query

    const symbolMatch =
      !query.symbols?.length || query.symbols.includes(i.attribute.symbol as string);
    const dateFromMatch = !query.date_from || (i.time_object.timestamp as string) >= query.date_from;
    const dateToMatch = !query.date_to || (i.time_object.timestamp as string) <= query.date_to;

    // Keep items that DO NOT match removal filter
    return !(symbolMatch && dateFromMatch && dateToMatch);
  });

  const countRemoved = countBefore - newEvents.length;

  meta.time_object = nowTimeObject();
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: metaPk(userId),
        SK: metaSk(datasetId),
        ...meta,
      },
    }),
  );
  await s3WriteJson(eventsBucket, datasetS3Key(userId, datasetId), toAdageData(meta, newEvents));

  return { count: countRemoved };
}
