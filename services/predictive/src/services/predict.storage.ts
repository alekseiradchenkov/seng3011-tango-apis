import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { AdageData } from "../../../../shared/types/adage.type";

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

export function datasetS3Key(userId: string, datasetId: string) {
  return `datasets/${userId}/${datasetId}.json`;
}

export function modelS3Key(userId: string, modelId: string) {
  return `models/${userId}/${modelId}.json`;
}

export async function datasetExists(userId: string, datasetId: string): Promise<boolean> {
  const table = requireEnv("EVENT_INDEX_TABLE");
  const ddb = getDdbDocClient();
  const out = await ddb.send(new GetCommand({ TableName: table, Key: { PK: metaPk(userId), SK: metaSk(datasetId) } }));
  return Boolean(out.Item);
}

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

export async function s3WriteJson(bucket: string, key: string, obj: unknown): Promise<void> {
  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(obj),
      ContentType: "application/json",
    }),
  );
}

export async function readDataset(userId: string, datasetId: string): Promise<AdageData | null> {
  const bucket = requireEnv("EVENTS_BUCKET");
  return await s3ReadJson<AdageData>(bucket, datasetS3Key(userId, datasetId));
}

export async function writeModel(userId: string, modelId: string, model: unknown): Promise<void> {
  const bucket = requireEnv("EVENTS_BUCKET");
  await s3WriteJson(bucket, modelS3Key(userId, modelId), model);
}

export async function readModel<T>(userId: string, modelId: string): Promise<T | null> {
  const bucket = requireEnv("EVENTS_BUCKET");
  return await s3ReadJson<T>(bucket, modelS3Key(userId, modelId));
}

