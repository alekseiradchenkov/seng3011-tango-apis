/**
 * Integration tests for the Visualisation API — /v1/charts endpoints
 *
 * Covers all CRUD operations on charts and the HTML render endpoint via the
 * v1 REST API. AWS DynamoDB and auth middleware are mocked so tests run
 * fully in-memory with no external dependencies.
 *
 * Run:      npx jest test/visualisation.test.ts
 * Coverage: npx jest test/visualisation.test.ts --coverage
 */

import * as express from "express";

// Imports Supertest, simulate HTTP requests (GET, POST, etc.) against your Express app.
const request = require("supertest") as typeof import("supertest");

// Replacing AWS DynamoDB with a simple in-memory object.
// Keys are stored as "chart_id" (the partition key used by the charts table).
const dynamo: Record<string, Record<string, any>> = {};

// Replaces the real DynamoDBClient and returns an empty object instead of a real AWS client.
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

// Mocks DynamoDBDocumentClient and intercepts all .send() calls, manually simulating
// DynamoDB operations using the in-memory dynamo store.
jest.mock("@aws-sdk/lib-dynamodb", () => {

  // Replaces the real `.send()` method used by DynamoDBDocumentClient.
  // Every database operation (Put, Get, Scan, Delete) will go through here.

  // The charts table uses a single partition key:
  //   PK = chart_id
  //
  // In this mock, we store items directly as:
  //   dynamo[chart_id] = item
  const send = jest.fn(async (cmd: any) => {

    // Extract common fields from the command input.
    const {
      Key,                       // Used for Get, Delete (identifies item)
      Item,                      // Used for Put (the item to store)
      FilterExpression,          // Used in Scan (e.g. "user_id = :uid")
      ExpressionAttributeValues, // Used in Scan (values like :uid)
    } = cmd.input;

    // Determines which DynamoDB operation is being executed.
    switch (cmd.constructor?.name) {

      // CREATE (PutCommand)
      case "PutCommand": {
        dynamo[Item.chart_id] = { ...Item };
        return {};
      }

      // READ SINGLE ITEM (GetCommand)
      case "GetCommand": {
        return { Item: dynamo[Key.chart_id] };
      }

      // SCAN MULTIPLE ITEMS (ScanCommand)
      // Filters by user_id when a FilterExpression is present.
      case "ScanCommand": {
        let items = Object.values(dynamo);
        if (FilterExpression && ExpressionAttributeValues?.[":uid"]) {
          items = items.filter((i) => i.user_id === ExpressionAttributeValues[":uid"]);
        }
        return { Items: items };
      }

      // DELETE ITEM (DeleteCommand)
      case "DeleteCommand": {
        delete dynamo[Key.chart_id];
        return {};
      }

      // DEFAULT (unknown command)
      default:
        return {};
    }
  });

  // Creates a fake DynamoDBDocumentClient that uses our mocked send().
  const mockDocClient = { send };

  return {
    DynamoDBDocumentClient: { from: jest.fn(() => mockDocClient) },
    PutCommand:    class PutCommand    { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
    GetCommand:    class GetCommand    { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
    ScanCommand:   class ScanCommand   { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
    DeleteCommand: class DeleteCommand { input: any; constructor(i: any) { this.input = i; Object.assign(this, i); } },
  };
});

// Auth middleware mock.
// Skips JWT validation and injects a fixed userId into every request.
const TEST_USER_ID = "user_test_ID_1!";

jest.mock("../../../shared/auth/user.auth", () => ({
  checkAuth: (req: any, _res: any, next: any) => {
    req.userId = TEST_USER_ID;
    next();
  },
}));

// Environment variables
process.env.CHARTS_TABLE = "test-charts-table";
process.env.AWS_DEFAULT_REGION = "ap-southeast-2";

// App factory
// Builds a minimal Express app mounting only the visualisation router. A fresh
// instance is created before each test to prevent state leaking between tests.
import visualisationRouter from "../src/routes/v1";

function buildTestApp(): express.Express {
  const app = (express as any).default ? (express as any).default() : (express as any)();
  const jsonMiddleware = (express as any).default
    ? (express as any).default.json()
    : (express as any).json();
  app.use(jsonMiddleware);
  app.use("/v1", visualisationRouter);
  return app;
}

// Fixtures
// A representative chart config reused across multiple tests.
const sampleChart = {
  type: "line",
  dataset_id: "dataset_abc123",
  x_axis: "date",
  y_axis: "close",
  title: "AAPL Closing Price",
  series: [
    {
      label: "AAPL",
      data: [
        { x: "2024-01-02", y: 186.5 },
        { x: "2024-01-03", y: 184.2 },
      ],
    },
  ],
};

// Helpers
// Wipes all in-memory DynamoDB state between tests so each test starts clean.
function resetStore(): void {
  Object.keys(dynamo).forEach((k) => delete dynamo[k]);
}

// POSTs to /v1/charts to create a new chart and returns the full supertest response.
async function postCreateChart(
  app: express.Express,
  overrides: Partial<typeof sampleChart> = {},
): Promise<any> {
  return request(app)
    .post("/v1/charts")
    .send({ ...sampleChart, ...overrides });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Visualisation API — /v1/charts", () => {
  let app: express.Express;

  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    app = buildTestApp();
  });

  // POST /v1/charts
  // Creates a new chart record for the authenticated user.
  // Pass (required fields only) = 201 + chart with generated chart_id and default series
  // Pass (with title)           = 201 + title is persisted in the response
  // Pass (with series)          = 201 + series array is persisted as-is
  // Pass (no series)            = 201 + series defaults to []
  // Fail (missing type)         = 400
  // Fail (missing dataset_id)   = 400
  // Fail (missing x_axis)       = 400
  // Fail (missing y_axis)       = 400
  describe("POST /v1/charts — create a new chart", () => {

    // Pass = 201 + a generated chart_id and all required fields are present
    it("creates a chart with correct defaults when all required fields are provided", async () => {
      const res = await postCreateChart(app);
      expect(res.status).toBe(201);
      expect(res.body.chart_id).toMatch(/^chr_/);
      expect(res.body.type).toBe("line");
      expect(res.body.dataset_id).toBe("dataset_abc123");
      expect(res.body.x_axis).toBe("date");
      expect(res.body.y_axis).toBe("close");
    });

    // Pass = 201 + title field is present in the response when provided
    it("persists the title when it is included in the request body", async () => {
      const res = await postCreateChart(app, { title: "Custom Title" });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Custom Title");
    });

    // Pass = 201 + series array is persisted unchanged when provided
    it("persists the series array when it is included in the request body", async () => {
      const res = await postCreateChart(app);
      expect(res.status).toBe(201);
      expect(res.body.series).toHaveLength(1);
      expect(res.body.series[0].label).toBe("AAPL");
    });

    // Pass = 201 + series defaults to an empty array when the field is omitted
    it("defaults series to an empty array when it is not provided", async () => {
      const { series: _omit, ...bodyWithoutSeries } = sampleChart;
      const res = await request(app).post("/v1/charts").send(bodyWithoutSeries);
      expect(res.status).toBe(201);
      expect(res.body.series).toEqual([]);
    });

    // Pass = 201 + a created_at timestamp is present on the returned chart
    it("sets a created_at timestamp on the newly created chart", async () => {
      const res = await postCreateChart(app);
      expect(res.status).toBe(201);
      expect(res.body.created_at).toBeDefined();
    });

    // Pass = user_id on the stored chart matches the authenticated user
    it("associates the new chart with the authenticated user", async () => {
      const res = await postCreateChart(app);
      expect(res.body.user_id).toBe(TEST_USER_ID);
    });

    // Fail = 400 when the type field is missing
    it("returns 400 when the type field is missing from the request body", async () => {
      const { type: _omit, ...body } = sampleChart;
      const res = await request(app).post("/v1/charts").send(body);
      expect(res.status).toBe(400);
    });

    // Fail = 400 when the dataset_id field is missing
    it("returns 400 when the dataset_id field is missing from the request body", async () => {
      const { dataset_id: _omit, ...body } = sampleChart;
      const res = await request(app).post("/v1/charts").send(body);
      expect(res.status).toBe(400);
    });

    // Fail = 400 when the x_axis field is missing
    it("returns 400 when the x_axis field is missing from the request body", async () => {
      const { x_axis: _omit, ...body } = sampleChart;
      const res = await request(app).post("/v1/charts").send(body);
      expect(res.status).toBe(400);
    });

    // Fail = 400 when the y_axis field is missing
    it("returns 400 when the y_axis field is missing from the request body", async () => {
      const { y_axis: _omit, ...body } = sampleChart;
      const res = await request(app).post("/v1/charts").send(body);
      expect(res.status).toBe(400);
    });
  });

  // GET /v1/charts
  // Returns the list of charts owned by the authenticated user.
  // Pass (no charts)   = 200 + empty array
  // Pass (has charts)  = 200 + array containing all charts for the current user
  // Isolation          = charts belonging to other users are never returned
  describe("GET /v1/charts — list all charts for the current user", () => {

    // Pass = 200 + empty array when the user owns no charts
    it("returns an empty array when the user has no charts", async () => {
      const res = await request(app).get("/v1/charts");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    // Pass = 200 + array containing all charts created by the authenticated user
    it("returns all charts belonging to the authenticated user", async () => {
      await postCreateChart(app, { title: "Chart A" });
      await postCreateChart(app, { title: "Chart B" });

      const res = await request(app).get("/v1/charts");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const titles = res.body.map((c: any) => c.title);
      expect(titles).toContain("Chart A");
      expect(titles).toContain("Chart B");
    });

    // Isolation = charts stored under a different user's user_id are not returned
    it("does not expose charts belonging to a different user", async () => {
      dynamo["chr_other_user_chart"] = {
        chart_id: "chr_other_user_chart",
        user_id: "other_user",
        type: "bar",
        dataset_id: "dataset_xyz",
        x_axis: "date",
        y_axis: "open",
        series: [],
        created_at: new Date().toISOString(),
      };

      const res = await request(app).get("/v1/charts");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // GET /v1/charts/:chartId
  // Returns a single chart by its id.
  // Pass (valid id)  = 200 + correct chart body
  // Fail (not found) = 404
  describe("GET /v1/charts/:chartId — retrieve a single chart", () => {

    // Pass = 200 + the correct chart_id and fields are returned
    it("returns the chart for a valid chart id", async () => {
      const createRes = await postCreateChart(app);
      const { chart_id } = createRes.body;

      const res = await request(app).get(`/v1/charts/${chart_id}`);
      expect(res.status).toBe(200);
      expect(res.body.chart_id).toBe(chart_id);
      expect(res.body.type).toBe("line");
      expect(res.body.x_axis).toBe("date");
    });

    // Fail = 404 when no DynamoDB record exists for the given id
    it("returns 404 when the chart id does not exist", async () => {
      const res = await request(app).get("/v1/charts/chr_does_not_exist");
      expect(res.status).toBe(404);
    });
  });

  // DELETE /v1/charts/:chartId
  // Permanently deletes a chart record.
  // Pass = 200 + { count: 1 }, chart no longer appears in the list
  // Fail = 404 when the id does not exist
  describe("DELETE /v1/charts/:chartId — remove a chart", () => {

    // Pass = 200 + { count: 1 } and the chart is absent from the subsequent list
    it("deletes the chart and returns a count of 1", async () => {
      const createRes = await postCreateChart(app);
      const { chart_id } = createRes.body;

      const res = await request(app).delete(`/v1/charts/${chart_id}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);

      const listRes = await request(app).get("/v1/charts");
      expect(listRes.body).toHaveLength(0);
    });

    // Fail = 404 when the chart id does not match any stored record
    it("returns 404 for an unrecognised chart id", async () => {
      const res = await request(app).delete("/v1/charts/chr_ghost");
      expect(res.status).toBe(404);
    });
  });

  // GET /v1/charts/:chartId/render
  // Returns an HTML page containing an embedded Chart.js visualisation.
  // Pass (valid id)       = 200 + Content-Type text/html
  // Pass (html structure) = response body contains canvas element and Chart.js script tag
  // Pass (data embedded)  = series data and axis labels are embedded in the HTML
  // Pass (title)          = chart title appears in the HTML
  // Fail (not found)      = 404
  describe("GET /v1/charts/:chartId/render — render chart as HTML", () => {

    // Pass = 200 + Content-Type is text/html
    it("returns a 200 response with Content-Type text/html for a valid chart id", async () => {
      const createRes = await postCreateChart(app);
      const { chart_id } = createRes.body;

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });

    // Pass = response body contains a canvas element for Chart.js to target
    it("includes a canvas element in the rendered HTML", async () => {
      const createRes = await postCreateChart(app);
      const { chart_id } = createRes.body;

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.text).toContain("<canvas");
    });

    // Pass = response body includes the Chart.js CDN script tag
    it("includes the Chart.js CDN script tag in the rendered HTML", async () => {
      const createRes = await postCreateChart(app);
      const { chart_id } = createRes.body;

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.text).toContain("chart.js");
    });

    // Pass = the chart type (e.g. "line") is embedded in the rendered script block
    it("embeds the chart type in the rendered script block", async () => {
      const createRes = await postCreateChart(app, { type: "bar" });
      const { chart_id } = createRes.body;

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.text).toContain('"bar"');
    });

    // Pass = the axis labels are embedded in the rendered script block
    it("embeds x_axis and y_axis labels in the rendered script block", async () => {
      const createRes = await postCreateChart(app, { x_axis: "date", y_axis: "close" });
      const { chart_id } = createRes.body;

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.text).toContain('"date"');
      expect(res.text).toContain('"close"');
    });

    // Pass = the chart title appears in the rendered HTML
    it("includes the chart title in the rendered HTML", async () => {
      const createRes = await postCreateChart(app, { title: "My Render Test" });
      const { chart_id } = createRes.body;

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.text).toContain("My Render Test");
    });

    // Pass = the dataset_id is embedded in the rendered HTML metadata
    it("displays the dataset_id in the rendered HTML metadata", async () => {
      const createRes = await postCreateChart(app);
      const { chart_id, dataset_id } = createRes.body;

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.text).toContain(dataset_id);
    });

    // Fail = 404 when the chart id does not match any stored record
    it("returns 404 when the chart id does not exist", async () => {
      const res = await request(app).get("/v1/charts/chr_ghost/render");
      expect(res.status).toBe(404);
    });
  });

  // GET /v1/events/summary
  // Stub endpoint — returns a placeholder summary shape.
  // Pass = 200 + response body matches the expected stub structure
  describe("GET /v1/events/summary — stub summary endpoint", () => {

    // Pass = 200 + stub body has dataset_id, sectors, companies, and recent_trends
    it("returns 200 with the expected placeholder stub structure", async () => {
      const res = await request(app).get("/v1/events/summary");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("dataset_id");
      expect(res.body).toHaveProperty("sectors");
      expect(res.body).toHaveProperty("companies");
      expect(res.body).toHaveProperty("recent_trends");
    });

    // Pass = sectors, companies, and recent_trends are empty arrays in the stub
    it("returns empty arrays for sectors, companies, and recent_trends", async () => {
      const res = await request(app).get("/v1/events/summary");
      expect(res.body.sectors).toEqual([]);
      expect(res.body.companies).toEqual([]);
      expect(res.body.recent_trends).toEqual([]);
    });
  });

  // GET /v1/events/trends
  // Stub endpoint — returns a placeholder trends shape.
  // Pass = 200 + response body matches the expected stub structure
  describe("GET /v1/events/trends — stub trends endpoint", () => {

    // Pass = 200 + stub body has event_count and dataset fields
    it("returns 200 with the expected placeholder stub structure", async () => {
      const res = await request(app).get("/v1/events/trends");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("event_count");
      expect(res.body).toHaveProperty("dataset");
    });

    // Pass = event_count is 0 and dataset is null in the stub
    it("returns event_count of 0 and a null dataset", async () => {
      const res = await request(app).get("/v1/events/trends");
      expect(res.body.event_count).toBe(0);
      expect(res.body.dataset).toBeNull();
    });
  });

  // Error-handler middleware (last router.use in v1.ts)
  // When any route calls next(err), the error-handler catches it and returns 500
  // with an INTERNAL error code and the error message string.
  // Pass (POST throws)   = 500 + { error: "INTERNAL", message: <err message> }
  // Pass (GET throws)    = 500 + { error: "INTERNAL", message: <err message> }
  // Pass (DELETE throws) = 500 + { error: "INTERNAL", message: <err message> }
  // Pass (render throws) = 500 + { error: "INTERNAL", message: <err message> }
  describe("Error-handler middleware — unhandled errors from route handlers", () => {

    // Helper: retrieves the mocked send() spy from the lib-dynamodb mock so individual
    // tests can temporarily override it to simulate a DynamoDB failure.
    function getDynamoSend() {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient.from().send as jest.Mock;
    }

    // Pass = POST /charts calls next(err) when DynamoDB.send throws; handler returns 500
    it("returns 500 with INTERNAL error when POST /charts DynamoDB send throws", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      getDynamoSend().mockRejectedValueOnce(new Error("DynamoDB unavailable"));

      const res = await postCreateChart(app);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("INTERNAL");
      expect(res.body.message).toContain("DynamoDB unavailable");
      consoleSpy.mockRestore();
    });

    // Pass = GET /charts calls next(err) when DynamoDB.send throws; handler returns 500
    it("returns 500 with INTERNAL error when GET /charts DynamoDB send throws", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      getDynamoSend().mockRejectedValueOnce(new Error("Scan failed"));

      const res = await request(app).get("/v1/charts");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("INTERNAL");
      consoleSpy.mockRestore();
    });

    // Pass = GET /charts/:chartId calls next(err) when DynamoDB.send throws; handler returns 500
    it("returns 500 with INTERNAL error when GET /charts/:chartId DynamoDB send throws", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      getDynamoSend().mockRejectedValueOnce(new Error("Get failed"));

      const res = await request(app).get("/v1/charts/chr_any_id");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("INTERNAL");
      consoleSpy.mockRestore();
    });

    // Pass = DELETE /charts/:chartId calls next(err) when DynamoDB.send throws; handler returns 500
    it("returns 500 with INTERNAL error when DELETE /charts/:chartId DynamoDB send throws", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      getDynamoSend().mockRejectedValueOnce(new Error("Delete failed"));

      const res = await request(app).delete("/v1/charts/chr_any_id");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("INTERNAL");
      consoleSpy.mockRestore();
    });

    // Pass = GET /charts/:chartId/render calls next(err) when DynamoDB.send throws; handler returns 500
    it("returns 500 with INTERNAL error when GET /charts/:chartId/render DynamoDB send throws", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      getDynamoSend().mockRejectedValueOnce(new Error("Render DB failed"));

      const res = await request(app).get("/v1/charts/chr_any_id/render");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("INTERNAL");
      consoleSpy.mockRestore();
    });
  });

  // buildChartHtml — fallback values
  // When a chart is created without a title, buildChartHtml generates a fallback
  // title from y_axis and x_axis. When series is absent from the stored item,
  // it defaults to an empty array and the datasets JS block is still valid.
  // Pass (no title)    = rendered HTML contains the generated "y over x" fallback title
  // Pass (empty series) = rendered HTML contains an empty series array in the script block
  describe("GET /v1/charts/:chartId/render — buildChartHtml fallback values", () => {

    // Pass = when title is omitted, the rendered page uses "<y_axis> over <x_axis>" as heading
    it("uses the y_axis over x_axis fallback when the chart has no title", async () => {
      // Create a chart without a title by bypassing postCreateChart and seeding
      // the store directly so the title field is absent from the stored item.
      const chart_id = "chr_notitle_test";
      dynamo[chart_id] = {
        chart_id,
        user_id: TEST_USER_ID,
        type: "line",
        dataset_id: "dataset_abc123",
        x_axis: "date",
        y_axis: "close",
        series: [],
        created_at: new Date().toISOString(),
        // title intentionally absent
      };

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.status).toBe(200);
      // Fallback title is "<y_axis> over <x_axis>"
      expect(res.text).toContain("close over date");
    });

    // Pass = when series is absent from the stored item, the rendered script block
    // contains an empty array literal so Chart.js receives valid input
    it("renders an empty series array when the stored chart has no series field", async () => {
      const chart_id = "chr_noseries_test";
      dynamo[chart_id] = {
        chart_id,
        user_id: TEST_USER_ID,
        type: "bar",
        dataset_id: "dataset_abc123",
        x_axis: "month",
        y_axis: "revenue",
        // series intentionally absent
        created_at: new Date().toISOString(),
      };

      const res = await request(app).get(`/v1/charts/${chart_id}/render`);
      expect(res.status).toBe(200);
      // JSON.stringify(undefined ?? []) → "[]"
      expect(res.text).toContain("const series = []");
    });
  });

  // requireEnv — missing environment variable
  // requireEnv() throws when a required env var is not set. This propagates
  // through next(err) to the error-handler on all DynamoDB-backed routes.
  // Pass = 500 when CHARTS_TABLE is unset at the time of the request
  describe("requireEnv — missing environment variable", () => {

    // Pass = any DynamoDB-backed route returns 500 when CHARTS_TABLE is not set
    it("returns 500 when the CHARTS_TABLE environment variable is missing", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const original = process.env.CHARTS_TABLE;
      delete process.env.CHARTS_TABLE;

      const res = await request(app).get("/v1/charts");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("INTERNAL");
      expect(res.body.message).toContain("CHARTS_TABLE");

      process.env.CHARTS_TABLE = original;
      consoleSpy.mockRestore();
    });
  });

  // getAwsEndpoint — endpoint resolution branches
  // getAwsEndpoint() checks AWS_ENDPOINT_URL first, then LOCALSTACK_HOSTNAME,
  // then returns undefined. These branches affect the DynamoDBClient constructor
  // options but not observable HTTP responses, so we verify they don't throw.
  // Pass (AWS_ENDPOINT_URL set)      = request succeeds with a custom endpoint URL
  // Pass (LOCALSTACK_HOSTNAME set)   = request succeeds with a LocalStack endpoint
  // Pass (neither set)               = request succeeds with undefined endpoint (default AWS)
  describe("getAwsEndpoint — DynamoDB endpoint resolution", () => {

    // Pass = AWS_ENDPOINT_URL is used when set; route still returns 200
    it("uses AWS_ENDPOINT_URL when it is set and completes the request successfully", async () => {
      process.env.AWS_ENDPOINT_URL = "http://localhost:8000";
      const createRes = await postCreateChart(app);
      expect(createRes.status).toBe(201);
      delete process.env.AWS_ENDPOINT_URL;
    });

    // Pass = LOCALSTACK_HOSTNAME is used when AWS_ENDPOINT_URL is absent; route still returns 200
    it("uses LOCALSTACK_HOSTNAME when AWS_ENDPOINT_URL is absent and completes the request successfully", async () => {
      delete process.env.AWS_ENDPOINT_URL;
      process.env.LOCALSTACK_HOSTNAME = "localhost";
      const createRes = await postCreateChart(app);
      expect(createRes.status).toBe(201);
      delete process.env.LOCALSTACK_HOSTNAME;
    });

    // Pass = returns undefined (standard AWS) when neither env var is set; route still returns 200
    it("falls back to the default AWS endpoint when neither env var is set", async () => {
      delete process.env.AWS_ENDPOINT_URL;
      delete process.env.LOCALSTACK_HOSTNAME;
      const createRes = await postCreateChart(app);
      expect(createRes.status).toBe(201);
    });
  });
});