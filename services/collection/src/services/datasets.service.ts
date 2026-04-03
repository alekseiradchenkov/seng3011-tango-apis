/**
 * Collection service business logic: dataset CRUD and event fetch/remove.
 *
 * @remarks
 * DynamoDB (`EVENT_INDEX_TABLE`) holds metadata (`PK` = `USER#<userId>`, `SK` = `DATASET#<datasetId>`).
 * S3 (`EVENTS_BUCKET`) stores the full ADAGE JSON at `datasets/<userId>/<datasetId>.json`.
 */

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


/**
 * @param name - Environment variable name.
 * @returns Non-empty value.
 * @throws Error if missing.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

/**
 * Resolves optional custom endpoint (LocalStack / CI); otherwise real AWS.
 */
function getAwsEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

/** DynamoDB DocumentClient with `removeUndefinedValues` for marshalling. */
function getDdbDocClient() {
  const endpoint = getAwsEndpoint();
  const ddb = new DynamoDBClient({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    endpoint,
  });
  return DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });
}

/** S3 client with path-style addressing (required for LocalStack). */
function getS3Client() {
  const endpoint = getAwsEndpoint();
  return new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    endpoint,
    forcePathStyle: true,
  });
}

/** Dynamo partition key for a user. */
function metaPk(userId: string) {
  return `USER#${userId}`;
}

/** Dynamo sort key for a dataset row. */
function metaSk(datasetId: string) {
  return `DATASET#${datasetId}`;
}

/** S3 key for the dataset JSON document. */
function datasetS3Key(userId: string, datasetId: string) {
  return `datasets/${userId}/${datasetId}.json`;
}

/**
 * Reads JSON from S3; returns `null` for missing/empty or most errors.
 */
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

/** Writes JSON to S3 (overwrites). */
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

/** Builds {@link AdageData} from metadata and events (omits undefined optional fields). */
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

/** Parses event timestamp to epoch ms for sorting. */
function parseEventTimeMs(event: AdageEvent): number {
  const raw = event.time_object?.timestamp ?? "";
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Coerces a value to a finite number or `null`. */
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/** Population standard deviation. */
function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Arithmetic mean of `values`. */
function movingAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

type DerivationSummary = {
  derivedEvents: AdageEvent[];
  eventTypeCounts: Record<string, number>;
};

/**
 * Derives price_jump, price_drop, volatility_spike, and trend_crossover events from OHLC rows.
 */
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

/**
 * Lists all datasets for a user (metadata only; events empty).
 */
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

/**
 * Creates dataset metadata in DynamoDB and an empty ADAGE JSON object in S3.
 */
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

/**
 * Loads metadata and up to 100 events from S3; `null` if not found.
 */
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

/**
 * Updates name/description and `time_object`; `null` if missing.
 */
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

/**
 * Removes Dynamo row and writes S3 tombstone `{ deleted: true }`. Returns `1` or `0`.
 */
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

/**
 * Fetches Yahoo OHLC, derives rule-engine events, merges into S3; `null` if dataset missing.
 */
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

/**
 * Filters out matching events in S3 by symbol/date; `null` if dataset missing.
 */
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
