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
  DatasetEventsQuery,
  DatasetPagination,
} from "../../../../shared/types/datasets.type";
import { nowTimeObject } from "../../../../shared/utils/time.util";
import { getYahooEod } from "./yahoo.service";

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
  return DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });
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
  } catch (e: any) {
    if (e?.name === "NoSuchKey") return null;
    return null;
  }
}

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

function toAdageData(meta: DatasetMetadata, events: AdageEvent[]): AdageData {
  return {
    data_source: meta.data_source,
    dataset_type: meta.dataset_type,
    dataset_id: meta.dataset_id,
    time_object: meta.time_object,
    events,
  };
}

export async function getDatasets(userId: string): Promise<DatasetMetadata[]> {
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

  return (out.Items ?? []).map((i: any) => ({
    data_source: i.data_source,
    dataset_type: i.dataset_type,
    dataset_id: i.dataset_id,
    time_object: i.time_object,
    user_id: i.user_id,
    name: i.name,
    description: i.description,
    filters: i.filters,
  }));
}

export async function createDataset(
  userId: string,
  input: DatasetCreateInput,
): Promise<DatasetMetadata> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const eventsBucket = requireEnv("EVENTS_BUCKET");
  const ddb = getDdbDocClient();

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

  await s3WriteJson(eventsBucket, datasetS3Key(userId, datasetId), toAdageData(meta, []));

  return meta;
}

export async function getDataset(
  userId: string,
  datasetId: string,
  pagination?: DatasetPagination,
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
  const limit = pagination?.limit && pagination.limit > 0 ? Math.min(pagination.limit, 100) : 100;
  const offset = pagination?.offset && pagination.offset > 0 ? pagination.offset : 0;
  return toAdageData(meta, events.slice(offset, offset + limit));
}

export async function updateDataset(
  userId: string,
  datasetId: string,
  input: DatasetCreateInput,
): Promise<DatasetMetadata | null> {
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
  const i: any = out.Attributes;
  return {
    data_source: i.data_source,
    dataset_type: i.dataset_type,
    dataset_id: i.dataset_id,
    time_object: i.time_object,
    user_id: i.user_id,
    name: i.name,
    description: i.description,
    filters: i.filters,
  };
}

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

export async function fetchEvents(
  userId: string,
  datasetId: string,
  query: DatasetEventsQuery,
): Promise<{ count: number; dataset: AdageData } | null> {
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

  // Strict mode: no fake fallback. If Yahoo fails, the request fails.
  const events = await getYahooEod({
    symbols: query.symbols,
    date_from: query.date_from,
    date_to: query.date_to,
  });

  const newFilters: DatasetFilters = {
    symbols: query.symbols,
    ...(query.exchange ? { exchange: query.exchange } : {}),
    ...(query.date_from ? { date_from: query.date_from } : {}),
    ...(query.date_to ? { date_to: query.date_to } : {}),
    ...(query.sort ? { sort: query.sort } : {}),
    ...(query.limit ? { limit: query.limit } : {}),
    ...(query.offset ? { offset: query.offset } : {}),
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

  const full = toAdageData(meta, events);
  await s3WriteJson(eventsBucket, datasetS3Key(userId, datasetId), full);

  return {
    count: events.length,
    dataset: toAdageData(meta, events.slice(0, 100)),
  };
}

export async function removeEvents(
  userId: string,
  datasetId: string,
  query?: DatasetEventsQuery,
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
    const exchangeMatch = !query.exchange || (i.attribute.exchange as string) === query.exchange;
    const dateFromMatch = !query.date_from || (i.time_object.timestamp as string) >= query.date_from;
    const dateToMatch = !query.date_to || (i.time_object.timestamp as string) <= query.date_to;

    // Keep items that DO NOT match removal filter
    return !(symbolMatch && exchangeMatch && dateFromMatch && dateToMatch);
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
