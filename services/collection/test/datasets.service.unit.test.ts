/**
 * Unit tests for `datasets.service.ts`.
 *
 * These tests mock DynamoDB + S3 + Yahoo and exercise the internal
 * derivation logic so we can reach high coverage.
 */

const dynamo: Record<string, any> = {};
const s3: Record<string, any> = {};

function pk(userId: string) {
  return `USER#${userId}`;
}
function sk(datasetId: string) {
  return `DATASET#${datasetId}`;
}
function ddbKey(userId: string, datasetId: string) {
  return `${pk(userId)}#${sk(datasetId)}`;
}

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

const sendMock = jest.fn(async (cmd: any) => {
  const input = cmd?.input ?? {};

  const { Key, Item, ExpressionAttributeValues, UpdateExpression, ExpressionAttributeNames } =
    input;

  switch (cmd.constructor?.name) {
    case "PutCommand": {
      // PutCommand: { PK, SK, ...meta }
      dynamo[`${Item.PK}#${Item.SK}`] = { ...Item };
      return {};
    }
    case "GetCommand": {
      const key = `${Key.PK}#${Key.SK}`;
      return { Item: dynamo[key] };
    }
    case "QueryCommand": {
      const uPk = ExpressionAttributeValues?.[":pk"];
      const prefix = ExpressionAttributeValues?.[":skPrefix"] ?? "";
      const items = Object.values(dynamo).filter(
        (i: any) => i.PK === uPk && String(i.SK).startsWith(prefix),
      );
      return { Items: items };
    }
    case "UpdateCommand": {
      const key = `${Key.PK}#${Key.SK}`;
      const existing = dynamo[key];
      if (!existing) return { Attributes: undefined };

      // Minimal UpdateExpression parsing used by the service:
      // "SET #t = :t, #n = :n, #d = :d" (some clauses optional)
      const setPart = String(UpdateExpression ?? "").replace(/^SET\s+/i, "");
      const clauses = setPart
        .split(",")
        .map((c: string) => c.trim())
        .filter(Boolean);

      const updated = { ...existing };
      for (const clause of clauses) {
        const [lhsRaw, rhsRaw] = clause.split("=").map((s: string) => s.trim());
        const realKey = ExpressionAttributeNames?.[lhsRaw] ?? lhsRaw;
        if (rhsRaw in (ExpressionAttributeValues ?? {})) {
          updated[realKey] = ExpressionAttributeValues[rhsRaw];
        }
      }

      dynamo[key] = updated;
      return { Attributes: updated };
    }
    case "DeleteCommand": {
      const key = `${Key.PK}#${Key.SK}`;
      delete dynamo[key];
      return {};
    }
    default:
      throw new Error(`Unhandled DDB mock command: ${cmd?.constructor?.name}`);
  }
});

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: sendMock })),
  },
  PutCommand: class PutCommand {
    input: any;
    constructor(i: any) {
      this.input = i;
      Object.assign(this, i);
    }
  },
  GetCommand: class GetCommand {
    input: any;
    constructor(i: any) {
      this.input = i;
      Object.assign(this, i);
    }
  },
  QueryCommand: class QueryCommand {
    input: any;
    constructor(i: any) {
      this.input = i;
      Object.assign(this, i);
    }
  },
  UpdateCommand: class UpdateCommand {
    input: any;
    constructor(i: any) {
      this.input = i;
      Object.assign(this, i);
    }
  },
  DeleteCommand: class DeleteCommand {
    input: any;
    constructor(i: any) {
      this.input = i;
      Object.assign(this, i);
    }
  },
}));

jest.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand {
    input: any;
    constructor(i: any) {
      this.input = i;
      Object.assign(this, i);
    }
  }

  class PutObjectCommand {
    input: any;
    constructor(i: any) {
      this.input = i;
      Object.assign(this, i);
    }
  }

  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(async (cmd: any) => {
        if (cmd instanceof GetObjectCommand) {
          const key = `${cmd.input.Bucket}/${cmd.input.Key}`;
          if (!(key in s3)) {
            const err: any = new Error("NoSuchKey");
            err.name = "NoSuchKey";
            throw err;
          }
          return {
            Body: {
              transformToString: async () => JSON.stringify(s3[key]),
            },
          };
        }
        if (cmd instanceof PutObjectCommand) {
          const key = `${cmd.input.Bucket}/${cmd.input.Key}`;
          s3[key] = JSON.parse(String(cmd.input.Body));
          return {};
        }
        throw new Error(`Unhandled S3 command: ${cmd?.constructor?.name}`);
      }),
    })),
    GetObjectCommand,
    PutObjectCommand,
  };
});

// Mock Yahoo Finance fetch
const getYahooEodMock = jest.fn();
jest.mock("../src/services/yahoo.service", () => ({
  getYahooEod: (...args: unknown[]) => getYahooEodMock(...args),
}));

import {
  createDataset,
  deleteDataset,
  fetchEvents,
  getDataset,
  getDatasets,
  removeEvents,
  updateDataset,
} from "../src/services/datasets.service";

beforeEach(() => {
  Object.keys(dynamo).forEach((k) => delete dynamo[k]);
  Object.keys(s3).forEach((k) => delete s3[k]);

  process.env.EVENT_INDEX_TABLE = "EventIndexTable";
  process.env.EVENTS_BUCKET = "EventDatasetsBucket";
  delete process.env.AWS_ENDPOINT_URL;
  delete process.env.LOCALSTACK_HOSTNAME;

  getYahooEodMock.mockReset();
});

function timestampForDay(dayIndex: number) {
  const base = new Date("2024-01-01T00:00:00.000Z");
  const d = new Date(base.getTime() + dayIndex * 24 * 60 * 60 * 1000);
  // Keep the space-separated format the parser expects in other code
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} 00:00:00.000`;
}

function buildRawEvents() {
  // Symbol A (AAPL): used for volatility_spike + trend_crossover
  const aaplEvents: any[] = [];
  const closesA: number[] = [];
  for (let i = 0; i <= 50; i += 1) {
    if (i <= 19) closesA.push(100);
    else if (i <= 29) closesA.push(i % 2 === 0 ? 90 : 110);
    else if (i <= 49) closesA.push(100);
    else closesA.push(110); // i=50
  }

  for (let i = 0; i < closesA.length; i += 1) {
    aaplEvents.push({
      time_object: { timestamp: timestampForDay(i) },
      event_type: "stock_ohlc",
      attribute: {
        symbol: "AAPL.XNAS",
        open: closesA[i],
        high: closesA[i],
        low: closesA[i],
        close: closesA[i],
        volume: 1000,
      },
    });
  }

  // Symbol B (MSFT): used for price_jump + price_drop
  const msftCloses = [100, 106, 100, 90, 95, 100];
  const msftEvents: any[] = [];
  for (let i = 0; i < msftCloses.length; i += 1) {
    msftEvents.push({
      time_object: { timestamp: timestampForDay(200 + i) },
      event_type: "stock_ohlc",
      attribute: {
        symbol: "MSFT.XNAS",
        open: msftCloses[i],
        high: msftCloses[i],
        low: msftCloses[i],
        close: msftCloses[i],
        volume: 2000,
      },
    });
  }

  return [...aaplEvents, ...msftEvents];
}

describe("datasets.service — exported AWS-backed functions", () => {
  it("createDataset writes metadata to DynamoDB and ADAGE JSON to S3", async () => {
    getYahooEodMock.mockResolvedValue([]);

    const userId = "user-1";
    const res = await createDataset(userId, { name: "n", description: "d" });

    expect(res.dataset_type).toBe("daily_stock_ohlc_data");
    expect(res.dataset_id).toMatch(/^dataset_/);

    // Metadata saved
    const metaKeys = Object.keys(dynamo);
    expect(metaKeys).toHaveLength(1);

    // S3 object saved
    const s3Keys = Object.keys(s3);
    expect(s3Keys).toHaveLength(1);
    expect(s3[s3Keys[0]]).toEqual({ ...res, events: [] });
  });

  it("getDatasets maps QueryCommand results into ADAGE documents", async () => {
    // Seed DynamoDB directly through createDataset
    const userId = "u";
    await createDataset(userId, { name: "n", description: "d" });

    const out = await getDatasets(userId);
    expect(out.length).toBe(1);
    expect(out[0].dataset_id).toMatch(/^dataset_/);
    expect(out[0].events).toEqual([]);
  });

  it("getDataset returns metadata only and slices events from S3", async () => {
    const userId = "u1";
    const meta = await createDataset(userId, { name: "n" });

    // Seed S3 dataset object with 3 events
    const key = `EventDatasetsBucket/datasets/${userId}/${meta.dataset_id}.json`;
    s3[key] = {
      ...meta,
      events: [
        { time_object: { timestamp: "2024-01-01 00:00:00.000" }, event_type: "stock_ohlc", attribute: { symbol: "AAPL.XNAS", close: 1 } },
        { time_object: { timestamp: "2024-01-02 00:00:00.000" }, event_type: "stock_ohlc", attribute: { symbol: "AAPL.XNAS", close: 2 } },
        { time_object: { timestamp: "2024-01-03 00:00:00.000" }, event_type: "stock_ohlc", attribute: { symbol: "AAPL.XNAS", close: 3 } },
      ],
    };

    const out = await getDataset(userId, meta.dataset_id);
    expect(out).not.toBeNull();
    expect(out?.dataset_id).toBe(meta.dataset_id);
    expect((out as any).events).toHaveLength(3);
  });

  it("updateDataset builds UpdateExpression for name only and description only", async () => {
    const userId = "u";
    const meta = await createDataset(userId, { name: "old" });

    // name only
    const out1 = await updateDataset(userId, meta.dataset_id, { name: "new-name" });
    expect(out1?.name).toBe("new-name");

    // description only
    const out2 = await updateDataset(userId, meta.dataset_id, { description: "new-desc" } as any);
    expect(out2?.description).toBe("new-desc");
  });

  it("deleteDataset deletes DynamoDB record and writes {deleted:true} to S3", async () => {
    const userId = "u";
    const meta = await createDataset(userId, { name: "n" });

    const res = await deleteDataset(userId, meta.dataset_id);
    expect(res).toBe(1);

    const key = `EventDatasetsBucket/datasets/${userId}/${meta.dataset_id}.json`;
    expect(s3[key]).toEqual({ deleted: true });
    expect(dynamo).toEqual({});
  });

  it("fetchEvents merges raw + derived events and updates event_type_counts", async () => {
    const userId = "u";
    const meta = await createDataset(userId, { name: "n" });
    const raw = buildRawEvents();
    getYahooEodMock.mockResolvedValue(raw);

    const out = await fetchEvents(userId, meta.dataset_id, {
      symbols: ["AAPL", "MSFT"],
      exchange: "XNAS",
      date_from: "2024-01-01",
      date_to: "2024-02-01",
    });

    expect(out).not.toBeNull();
    expect(out?.raw_event_count).toBe(raw.length);
    expect(out?.derived_event_count).toBeGreaterThan(0);
    expect(out?.event_type_counts.stock_ohlc).toBe(raw.length);

    // Ensure derived event types exist (at least these two should trigger)
    const keys = Object.keys(out!.event_type_counts);
    expect(keys).toEqual(expect.arrayContaining(["stock_ohlc"]));
    expect(keys.some((k) => k !== "stock_ohlc")).toBe(true);
  });

  it("removeEvents removes all events when called without query, and respects symbol filters", async () => {
    const userId = "u";
    const meta = await createDataset(userId, { name: "n" });

    const key = `EventDatasetsBucket/datasets/${userId}/${meta.dataset_id}.json`;
    const raw = buildRawEvents();
    s3[key] = {
      ...meta,
      events: raw.map((e: any) => ({
        time_object: e.time_object,
        event_type: e.event_type,
        attribute: e.attribute,
      })),
    };

    // Remove all (query omitted)
    const outAll = await removeEvents(userId, meta.dataset_id);
    expect(outAll?.count).toBe(raw.length);

    // Re-seed
    s3[key] = { ...s3[key], events: raw };

    // Remove only MSFT events via symbol filter
    const outSome = await removeEvents(userId, meta.dataset_id, { symbols: ["MSFT.XNAS"] });
    expect(outSome?.count).toBeGreaterThan(0);
    expect(outSome?.count).toBeLessThanOrEqual(raw.length);
  });
});

