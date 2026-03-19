/**
 * Integration tests for the Data Collection API — /v1/datasets endpoints
 *
 * Covers all CRUD operations on datasets and event management via the
 * v1 REST API. AWS DynamoDB, S3, auth middleware, Yahoo service, and the
 * time utility are all mocked so tests run fully in-memory with no
 * external dependencies.
 */

import * as express from "express";

// Imports Supertest, simulate HTTP requests (GET, POST, etc.) against your Express app.
const request = require("supertest") as typeof import("supertest");

// replacing AWS services (DynamoDB + S3) with simple in-memory objects
const dynamo: Record<string, Record<string, any>> = {};
const s3Store: Record<string, any> = {};

// Flag used later (in S3 mock) to force an error (false = normal behaviour, true = simulate a generic S3 failure)
let s3ForceGenericError = false;

// Replaces the real DynamoDBClient and returns an empty object instead of a real AWS client
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

// Mocks DynamoDBDocumentClient and intercept all .send() calls, manually simulate DynamoDB operations using the dynamo
jest.mock("@aws-sdk/lib-dynamodb", () => {

  // Replaces the real `.send()` method used by DynamoDBDocumentClient
  // Every database operation (Put, Get, Query, Update, Delete) will go through here

  // DynamoDB uses:
  //   PK (Partition Key) = groups items (e.g. "USER#1")
  //   SK (Sort Key) = identifies items within that group (e.g. "DATASET#1")

  // In this mock, we combine them into one key:
  //   dynamo["PK#SK"] = item
  const send = jest.fn(async (cmd: any) => {

    // Extract common fields from the command input
    const {
      Key,                        // Used for Get, Update, Delete (identifies item)
      Item,                       // Used for Put (the item to store)
      ExpressionAttributeValues,  // Used in Query/Update (values like :pk, :t)
      ExpressionAttributeNames,   // Used in Update (maps #t → actual field name)
      UpdateExpression            // Used in Update (e.g. "SET #t = :t")
    } = cmd.input;

    // Determines which DynamoDB operation is being executed
    switch (cmd.constructor?.name) {

      // CREATE (PutCommand)
      case "PutCommand": {
        dynamo[`${Item.PK}#${Item.SK}`] = { ...Item };
        return {};
      }

      // READ SINGLE ITEM (GetCommand)
      case "GetCommand": {
        return { Item: dynamo[`${Key.PK}#${Key.SK}`] };
      }

      // QUERY MULTIPLE ITEMS (QueryCommand)
      case "QueryCommand": {
        const pk = ExpressionAttributeValues[":pk"];
        const prefix = ExpressionAttributeValues[":skPrefix"] ?? "";
        return {
          Items: Object.values(dynamo).filter(
            (i) => i.PK === pk && i.SK.startsWith(prefix),
          ),
        };
      }

      // UPDATE ITEM (UpdateCommand)
      case "UpdateCommand": {
        const existing = dynamo[`${Key.PK}#${Key.SK}`];
        if (!existing) return { Attributes: undefined };
        // Parse "SET #t = :t, #n = :n" and apply each assignment to the stored item
        const setPart = UpdateExpression.replace(/^SET\s+/i, "");
        
        for (const clause of setPart.split(",")) {
          const [lhs, rhs] = clause.trim().split("=").map((s: string) => s.trim());
          const realKey = ExpressionAttributeNames[lhs] ?? lhs;
          if (rhs in ExpressionAttributeValues) existing[realKey] = ExpressionAttributeValues[rhs];
        }

        dynamo[`${Key.PK}#${Key.SK}`] = existing;
        return { Attributes: existing };
      }

      // DELETE ITEM (DeleteCommand)
      case "DeleteCommand": {
        delete dynamo[`${Key.PK}#${Key.SK}`];
        return {};
      }

      // DEFAULT (unknown command)
      default:
        return {};
    }
  });
 
  //Creates a fake DynamoDBDocumentClient that uses our mocked send()
  const mockDocClient = { send };
 
  return {
    DynamoDBDocumentClient: { from: jest.fn(() => mockDocClient) },
    PutCommand: class PutCommand { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
    GetCommand: class GetCommand { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
    QueryCommand: class QueryCommand { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
    UpdateCommand: class UpdateCommand { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
    DeleteCommand: class DeleteCommand { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
  };
});

// Mock S3Client.send() to store/retrieve JSON objects in memory for PutObjectCommand and GetObjectCommand,
// with optional simulated network errors for testing.
jest.mock("@aws-sdk/client-s3", () => {
  const send = jest.fn(async (cmd: any) => {
    const { Bucket, Key, Body } = cmd.input ?? cmd;
    const bucket = Bucket ?? cmd.input?.Bucket;
    const key = Key ?? cmd.input?.Key;

    if (cmd.constructor?.name === "PutObjectCommand") {
      const body = Body ?? cmd.input?.Body;
      s3Store[`${bucket}/${key}`] = JSON.parse(body);
      return {};
    }

    if (cmd.constructor?.name === "GetObjectCommand") {
      // Allows individual tests to simulate a non-NoSuchKey S3 failure
      if (s3ForceGenericError) {
        const err: any = new Error("NetworkError");
        err.name = "NetworkError"; // Not "NoSuchKey" → hits the catch-all branch in s3ReadJson
        throw err;
      }
      const stored = s3Store[`${bucket}/${key}`];
      if (!stored) {
        const err: any = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }
      return { Body: { transformToString: async () => JSON.stringify(stored) } };
    }

    return {};
  });

  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    GetObjectCommand: class GetObjectCommand { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
    PutObjectCommand: class PutObjectCommand { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
  };
});

// Auth middleware mock 
// Skips JWT validation and injects a fixed userId into every request.
const TEST_USER_ID = "user_test_ID_123!";

jest.mock("../../../shared/auth/user.auth", () => ({
  checkAuth: (req: any, _res: any, next: any) => {
    req.userId = TEST_USER_ID;
    next();
  },
}));

// Yahoo service mock 
// Replaces the live Yahoo Finance fetch with a Jest spy.
jest.mock("../src/services/yahoo.service", () => ({
  getYahooEod: jest.fn(),
}));

import { getYahooEod } from "../src/services/yahoo.service";
const mockGetYahooEod = getYahooEod as jest.MockedFunction<typeof getYahooEod>;

// Time utility mock
// Returns a fixed timestamp so dataset IDs and time_objects are deterministic.
jest.mock("../../../shared/utils/time.util", () => ({
  nowTimeObject: () => ({
    timestamp: "2023-05-09 00:00:00",
    timezone: "UTC",
    duration: 0,
    duration_unit: "second",
  }),
}));

// Environment variables
process.env.EVENT_INDEX_TABLE = "test-table";
process.env.EVENTS_BUCKET = "test-bucket";
process.env.AWS_DEFAULT_REGION = "ap-southeast-2";

// App factory
// Builds a minimal Express app mounting only the v1 router. A fresh instance
// is created before each test to prevent state leaking between tests.
import v1Router from "../src/routes/v1.route";

function buildTestApp(): express.Express {
  const app = (express as any).default ? (express as any).default() : (express as any)();
  const jsonMiddleware = (express as any).default ? (express as any).default.json() : (express as any).json();
  app.use(jsonMiddleware);
  app.use("/v1", v1Router);
  return app;
}

// Fixtures
// A representative OHLC stock event in Adage format, reused across multiple tests.
const sampleStockEvent = {
  time_object: {
    timestamp: "2024-01-02 00:00:00",
    timezone: "UTC",
    duration: 1,
    duration_unit: "day",
  },
  event_type: "stock_ohlc",
  attribute: {
    symbol: "AAPL.XNAS",
    open: 150.0,
    high: 160.5,
    low: 145.0,
    close: 186.5,
    volume: 4000000,
    currency: "USD",
  },
};

// Helpers
// Wipes all in-memory DynamoDB and S3 state between tests so each test starts clean.
function resetStores(): void {
  Object.keys(dynamo).forEach((k) => delete dynamo[k]);
  Object.keys(s3Store).forEach((k) => delete s3Store[k]);
}

// POSTs to /v1/datasets to create a new dataset and returns the full supertest response.
async function postCreateDataset(
  app: express.Express,
  name = "Test Dataset",
  description?: string,
): Promise<request.Response> {
  const body: any = { name };
  if (description) body.description = description;
  return request(app).post("/v1/datasets").send(body);
}

// Creates a dataset via the API then directly seeds its S3 event store with the
// provided events. Returns the dataset_id of the created dataset.
async function createAndSeedDataset(
  app: express.Express,
  events: any[],
): Promise<string> {
  const res = await postCreateDataset(app, "Seeded Dataset");
  const { dataset_id } = res.body;
  const s3Key = `test-bucket/datasets/${TEST_USER_ID}/${dataset_id}.json`;
  s3Store[s3Key] = { ...s3Store[s3Key], events };
  return dataset_id;
}

describe("Data Collection API — /v1/datasets", () => {
  let app: express.Express;
 
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    app = buildTestApp();
  });
 
  // GET /v1/datasets
  // Returns the list of datasets owned by the authenticated user.
  // Pass (no datasets)  = 200 + empty array
  // Pass (has datasets) = 200 + array containing only the current user's datasets
  // Isolation           = datasets belonging to other users are never returned
  describe("GET /v1/datasets — list all datasets for the current user", () => {
    // Pass = 200 + empty array when the user owns no datasets
    it("returns an empty array when the user has no datasets", async () => {
      const res = await request(app).get("/v1/datasets");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
 
    // Pass = 200 + array containing all datasets created by the authenticated user
    it("returns all datasets belonging to the authenticated user", async () => {
      await postCreateDataset(app, "Dataset A");
      await postCreateDataset(app, "Dataset B");
 
      const res = await request(app).get("/v1/datasets");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const names = res.body.map((d: any) => d.name);
      expect(names).toContain("Dataset A");
      expect(names).toContain("Dataset B");
    });
 
    // Isolation = datasets stored under a different user's PK are not returned
    it("does not expose datasets belonging to a different user", async () => {
      dynamo[`USER#other_user#DATASET#dataset_other_1`] = {
        PK: "USER#other_user", SK: "DATASET#dataset_other_1",
        dataset_id: "dataset_other_1", user_id: "other_user", name: "Other User Dataset",
        data_source: "YahooFinance", dataset_type: "daily_stock_ohlc_data",
        time_object: { timestamp: "2023-05-09 00:00:00", timezone: "UTC", duration: 0, duration_unit: "second" },
        filters: {},
      };
 
      const res = await request(app).get("/v1/datasets");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
 
  // POST /v1/datasets
  // Creates a new dataset for the authenticated user.
  // Pass (name only)         = 201 + dataset with correct defaults
  // Pass (name + desc)       = 201 + dataset with description set
  // Pass (empty event store) = S3 object is created with an empty events array
  // Fail (no name)           = 400
  // Fail (name not a string) = 400
  describe("POST /v1/datasets — create a new dataset", () => {
    // Pass = 201 + correct data_source, dataset_type, and a generated dataset_id
    it("creates a dataset with correct defaults when only a name is provided", async () => {
      const res = await postCreateDataset(app, "My Dataset");
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("My Dataset");
      expect(res.body.dataset_id).toMatch(/^dataset_/);
      expect(res.body.data_source).toBe("YahooFinance");
      expect(res.body.dataset_type).toBe("daily_stock_ohlc_data");
    });
 
    // Pass = 201 + description field is present in the response when provided
    it("creates a dataset with a description when both name and description are provided", async () => {
      const res = await postCreateDataset(app, "My Dataset", "Some description");
      expect(res.status).toBe(201);
      expect(res.body.description).toBe("Some description");
    });
 
    // Pass = an S3 object is created with an empty events array
    it("initialises an empty events array in S3 for the newly created dataset", async () => {
      const res = await postCreateDataset(app, "New Dataset");
      const { dataset_id } = res.body;
      const s3Key = `test-bucket/datasets/${TEST_USER_ID}/${dataset_id}.json`;
      expect(s3Store[s3Key]).toBeDefined();
      expect(s3Store[s3Key].events).toEqual([]);
    });
 
    // Fail = 400 when the name field is missing
    it("returns 400 when the name field is missing from the request body", async () => {
      const res = await request(app).post("/v1/datasets").send({});
      expect(res.status).toBe(400);
    });
 
    // Fail = 400 when name is not a string
    it("returns 400 when the name field is not a string", async () => {
      const res = await request(app).post("/v1/datasets").send({ name: 12345 });
      expect(res.status).toBe(400);
    });
  });
 
  // GET /v1/datasets/:datasetId
  // Returns a single dataset and a preview of its stored events.
  // Pass (valid id)  = 200 + dataset body with events array
  // Pass (large)     = 200 + events array capped at 100 entries
  // Fail (not found) = 404
  describe("GET /v1/datasets/:datasetId — retrieve a single dataset with its events", () => {
    // Pass = 200 + correct dataset_id and events array
    it("returns the dataset and its events for a valid dataset id", async () => {
      const dataset_id = await createAndSeedDataset(app, [sampleStockEvent, sampleStockEvent]);
 
      const res = await request(app).get(`/v1/datasets/${dataset_id}`);
      expect(res.status).toBe(200);
      expect(res.body.dataset_id).toBe(dataset_id);
      expect(res.body.events).toHaveLength(2);
    });
 
    // Pass (large) = events array is sliced to 100 even when more are stored in S3
    it("caps the returned events at 100 when the dataset has more than 100 events", async () => {
      const dataset_id = await createAndSeedDataset(app, Array(200).fill(sampleStockEvent));
 
      const res = await request(app).get(`/v1/datasets/${dataset_id}`);
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(100);
    });
 
    // Fail = 404 when no DynamoDB record exists for the given id
    it("returns 404 when the dataset id does not exist", async () => {
      const res = await request(app).get("/v1/datasets/does_not_exist");
      expect(res.status).toBe(404);
    });
  });
 
  // PUT /v1/datasets/:datasetId
  // Updates the name and/or description of an existing dataset.
  // Pass (name)        = 200 + updated name in response
  // Pass (name + desc) = 200 + both fields updated
  // Fail (not found)   = 404
  describe("PUT /v1/datasets/:datasetId — update dataset metadata", () => {
    // Pass = 200 + response body contains the new name
    it("updates the dataset name successfully", async () => {
      const createRes = await postCreateDataset(app, "Old Name");
      const { dataset_id } = createRes.body;
 
      const res = await request(app).put(`/v1/datasets/${dataset_id}`).send({ name: "New Name" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });
 
    // Pass = 200 + both name and description are updated when both are provided
    it("updates both name and description when both are provided", async () => {
      const createRes = await postCreateDataset(app, "Dataset", "Old desc");
      const { dataset_id } = createRes.body;
 
      const res = await request(app).put(`/v1/datasets/${dataset_id}`).send({ name: "Dataset", description: "New desc" });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe("New desc");
    });
 
    // Fail = 404 when no dataset exists for the given id
    it("returns 404 when the dataset id does not exist", async () => {
      const res = await request(app).put("/v1/datasets/ghost_id").send({ name: "Whatever" });
      expect(res.status).toBe(404);
    });
  });
 
  // DELETE /v1/datasets/:datasetId
  // Permanently deletes a dataset and its associated S3 event store.
  // Pass = 200 + { count: 1 }, dataset no longer appears in the list
  // Fail = 404 when the id does not exist
  describe("DELETE /v1/datasets/:datasetId — remove a dataset and its event store", () => {
    // Pass = 200 + { count: 1 } and the dataset is absent from the subsequent list
    it("deletes the dataset and returns a count of 1", async () => {
      const createRes = await postCreateDataset(app, "To Delete");
      const { dataset_id } = createRes.body;
 
      const res = await request(app).delete(`/v1/datasets/${dataset_id}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
 
      const listRes = await request(app).get("/v1/datasets");
      expect(listRes.body).toHaveLength(0);
    });
 
    // Fail = 404 when the dataset id does not match any stored record
    it("returns 404 for an unrecognised dataset id", async () => {
      const res = await request(app).delete("/v1/datasets/ghost_id");
      expect(res.status).toBe(404);
    });
  });
 
  // POST /v1/datasets/:datasetId/events/fetch
  // Fetches EOD stock events from Yahoo Finance and persists them in the dataset.
  // Pass (valid)          = 200 + { count, dataset.events }
  // Pass (symbol qualify) = bare tickers are suffixed with the exchange before calling Yahoo
  // Pass (filters saved)  = query filters are written back to the DynamoDB metadata record
  // Pass (large)          = count reflects all fetched events; preview in response capped at 100
  // Fail (not found)      = 404
  // Fail (empty symbols)  = 400
  // Fail (no exchange)    = 400
  // Fail (dotted symbol)  = 400
  // Fail (Yahoo error)    = 500
  describe("POST /v1/datasets/:datasetId/events/fetch — pull events from Yahoo Finance", () => {
    const validFetchBody = {
      symbols: ["AAPL", "MSFT"],
      exchange: "XNAS",
      date_from: "2023-05-09",
      date_to: "2024-01-31",
    };
 
    // Pass = 200 + count and events match what Yahoo returned
    it("fetches events from Yahoo and persists them in the dataset", async () => {
      mockGetYahooEod.mockResolvedValue([sampleStockEvent, sampleStockEvent]);
 
      const createRes = await postCreateDataset(app, "Stock Dataset");
      const { dataset_id } = createRes.body;
 
      const res = await request(app).post(`/v1/datasets/${dataset_id}/events/fetch`).send(validFetchBody);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.dataset.events).toHaveLength(2);
    });
 
    // Pass = Yahoo is called with TICKER.EXCHANGE qualified symbols
    it("qualifies bare tickers with the exchange suffix when calling the Yahoo service", async () => {
      mockGetYahooEod.mockResolvedValue([sampleStockEvent]);
 
      const createRes = await postCreateDataset(app, "Stock Dataset");
      const { dataset_id } = createRes.body;
 
      await request(app).post(`/v1/datasets/${dataset_id}/events/fetch`).send(validFetchBody);
 
      expect(mockGetYahooEod).toHaveBeenCalledWith(
        expect.objectContaining({ symbols: ["AAPL.XNAS", "MSFT.XNAS"] }),
      );
    });
 
    // Pass = DynamoDB metadata record is updated with the query filters after fetch
    it("persists the query filters onto the dataset metadata after a successful fetch", async () => {
      mockGetYahooEod.mockResolvedValue([sampleStockEvent]);
 
      const createRes = await postCreateDataset(app, "Stock Dataset");
      const { dataset_id } = createRes.body;
 
      await request(app).post(`/v1/datasets/${dataset_id}/events/fetch`).send(validFetchBody);
 
      const item = dynamo[`USER#${TEST_USER_ID}#DATASET#${dataset_id}`];
      expect(item?.filters?.symbols).toEqual(["AAPL", "MSFT"]);
      expect(item?.filters?.date_from).toBe("2023-05-09");
    });
 
    // Pass (large) = count equals total stored; events in response are capped at 100
    it("stores the full event count but caps the preview response at 100 events", async () => {
      mockGetYahooEod.mockResolvedValue(Array(150).fill(sampleStockEvent));
 
      const createRes = await postCreateDataset(app, "Large Dataset");
      const { dataset_id } = createRes.body;
 
      const res = await request(app).post(`/v1/datasets/${dataset_id}/events/fetch`).send(validFetchBody);
      expect(res.body.count).toBe(150);
      expect(res.body.dataset.events).toHaveLength(100);
    });
 
    // Fail = 404 when the dataset id does not exist
    it("returns 404 when the target dataset id does not exist", async () => {
      const res = await request(app).post("/v1/datasets/ghost_id/events/fetch").send(validFetchBody);
      expect(res.status).toBe(404);
    });
 
    // Fail = 400 when symbols is an empty array
    it("returns 400 when symbols is empty", async () => {
      const { dataset_id } = (await postCreateDataset(app, "Dataset")).body;
      const res = await request(app).post(`/v1/datasets/${dataset_id}/events/fetch`).send({ symbols: [], exchange: "XNAS" });
      expect(res.status).toBe(400);
    });
 
    // Fail = 400 when the exchange field is absent
    it("returns 400 when exchange is missing", async () => {
      const { dataset_id } = (await postCreateDataset(app, "Dataset")).body;
      const res = await request(app).post(`/v1/datasets/${dataset_id}/events/fetch`).send({ symbols: ["AAPL"] });
      expect(res.status).toBe(400);
    });
 
    // Fail = 400 when a symbol already contains a dot (exchange must be passed separately)
    it("returns 400 when a symbol contains a dot", async () => {
      const { dataset_id } = (await postCreateDataset(app, "Dataset")).body;
      const res = await request(app).post(`/v1/datasets/${dataset_id}/events/fetch`).send({ symbols: ["AAPL.XNAS"], exchange: "XNAS" });
      expect(res.status).toBe(400);
    });
 
    // Fail = 500 when the Yahoo service throws an unexpected error
    it("returns 500 when the Yahoo service throws an error", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      mockGetYahooEod.mockRejectedValue(new Error("Yahoo chart error: 500"));
 
      const { dataset_id } = (await postCreateDataset(app, "Error Dataset")).body;
      const res = await request(app).post(`/v1/datasets/${dataset_id}/events/fetch`).send(validFetchBody);
      expect(res.status).toBe(500);
      consoleSpy.mockRestore();
    });
  });
 
  // DELETE /v1/datasets/:datasetId/events/remove
  // Removes events matching the provided filters. Non-matching events are kept.
  // Pass (no filter)     = all events removed
  // Pass (symbol filter) = only matching symbol events removed
  // Pass (date filter)   = only events within the date range removed
  // Fail (not found)     = 404
  describe("DELETE /v1/datasets/:datasetId/events/remove — filter and remove stored events", () => {
    // Pass (no filter) = all events are removed when no filter fields are provided
    it("removes all events when no filter criteria are provided", async () => {
      const dataset_id = await createAndSeedDataset(app, Array(5).fill(sampleStockEvent));
 
      const res = await request(app).delete(`/v1/datasets/${dataset_id}/events/remove`).send({});
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
    });
 
    // Pass (symbol filter) = only events matching the symbol are removed; others are kept
    it("removes only events matching the specified symbol", async () => {
      const aaplEvent = { ...sampleStockEvent, attribute: { ...sampleStockEvent.attribute, symbol: "AAPL.XNAS" } };
      const msftEvent = { ...sampleStockEvent, attribute: { ...sampleStockEvent.attribute, symbol: "MSFT.XNAS" } };
      const dataset_id = await createAndSeedDataset(app, [aaplEvent, aaplEvent, msftEvent]);
 
      const res = await request(app).delete(`/v1/datasets/${dataset_id}/events/remove`).send({ symbols: ["AAPL.XNAS"] });
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });
 
    // Pass (date filter) = only events within the date range are removed
    it("removes only events that fall within the specified date range", async () => {
      const earlyEvent = { ...sampleStockEvent, time_object: { ...sampleStockEvent.time_object, timestamp: "2024-01-05 00:00:00" } };
      const lateEvent  = { ...sampleStockEvent, time_object: { ...sampleStockEvent.time_object, timestamp: "2024-03-01 00:00:00" } };
      const dataset_id = await createAndSeedDataset(app, [earlyEvent, lateEvent]);
 
      const res = await request(app).delete(`/v1/datasets/${dataset_id}/events/remove`).send({ date_from: "2023-05-09", date_to: "2024-02-01" });
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });
 
    // Fail = 404 when the dataset id does not exist
    it("returns 404 when the target dataset id does not exist", async () => {
      const res = await request(app).delete("/v1/datasets/ghost_id/events/remove").send({});
      expect(res.status).toBe(404);
    });
  });
 
  // s3ReadJson error branch
  // Covers the catch-all (non-NoSuchKey) error path in s3ReadJson (datasets.service.ts lines 71-72).
  // Pass = service catches the error gracefully and returns an empty events array
 
  describe("GET /v1/datasets/:datasetId — S3 generic error fallback", () => {
    // Pass = 200 + empty events array when S3 throws a non-NoSuchKey error
    it("returns an empty events array when S3 throws a non-NoSuchKey error", async () => {
      const { dataset_id } = (await postCreateDataset(app, "S3 Error Dataset")).body;
 
      s3ForceGenericError = true;
      const res = await request(app).get(`/v1/datasets/${dataset_id}`);
      s3ForceGenericError = false;
 
      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);
    });
  });
});