import {
  getDatasets,
  getDataset,
  createDataset,
  updateDataset,
  deleteDataset,
  fetchEvents,
  removeEvents,
} from "../src/services/datasets.service";
import {
  setMetadataTable,
  setDataStore,
  getDataStores,
  getMetadataTable,
} from "../../../shared/db/data.db";
import * as marketstackService from "../src/services/marketstack.service";
import { AdageEvent } from "../../../shared/types/adage.type";

const USER_A = "user-a";
const USER_B = "user-b";

function makeEvent(symbol: string, date: string): AdageEvent {
  return {
    time_object: {
      timestamp: date,
      timezone: "UTC",
      duration: 1,
      duration_unit: "day",
    },
    event_type: "stock_ohlc",
    attribute: { symbol },
  };
}

beforeEach(() => {
  setMetadataTable({});
  const stores = getDataStores();
  for (const key of Object.keys(stores)) {
    delete stores[key];
  }
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getDatasets
// ---------------------------------------------------------------------------

describe("getDatasets", () => {
  it("returns empty array for new user", () => {
    expect(getDatasets(USER_A)).toEqual([]);
  });

  it("returns only the calling user's datasets", () => {
    createDataset(USER_A, { name: "ds-a" });
    createDataset(USER_B, { name: "ds-b" });
    expect(getDatasets(USER_A)).toHaveLength(1);
    expect(getDatasets(USER_B)).toHaveLength(1);
  });

  it("returns AdageData shape with required fields", () => {
    const ds = createDataset(USER_A, { name: "test" });
    const result = getDatasets(USER_A);
    expect(result[0]).toMatchObject({
      dataset_id: ds.dataset_id,
      data_source: "MarketStack",
      dataset_type: "daily_stock_data",
      events: [],
    });
    expect(result[0].time_object).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createDataset
// ---------------------------------------------------------------------------

describe("createDataset", () => {
  it("returns AdageData with generated dataset_id and correct static fields", () => {
    const ds = createDataset(USER_A, { name: "my-dataset" });
    expect(ds.dataset_id).toMatch(/^dataset_\d+_\d+$/);
    expect(ds.data_source).toBe("MarketStack");
    expect(ds.dataset_type).toBe("daily_stock_data");
    expect(ds.events).toEqual([]);
    expect(ds.time_object).toBeDefined();
  });

  it("stores name and description in metadata", () => {
    createDataset(USER_A, { name: "full", description: "a description" });
    const meta = getMetadataTable()[USER_A][0];
    expect(meta.name).toBe("full");
    expect(meta.description).toBe("a description");
  });

  it("stores companies and sector in metadata filters", () => {
    createDataset(USER_A, {
      name: "full",
      companies: ["AAPL", "MSFT"],
      sector: "Technology",
    });
    const meta = getMetadataTable()[USER_A][0];
    expect(meta.filters?.companies).toEqual(["AAPL", "MSFT"]);
    expect(meta.filters?.sector).toBe("Technology");
  });

  it("multiple datasets are all listed", () => {
    createDataset(USER_A, { name: "a" });
    createDataset(USER_A, { name: "b" });
    expect(getDatasets(USER_A)).toHaveLength(2);
  });

  it("each dataset gets a unique dataset_id", () => {
    const a = createDataset(USER_A, { name: "a" });
    const b = createDataset(USER_A, { name: "b" });
    expect(a.dataset_id).not.toBe(b.dataset_id);
  });
});

// ---------------------------------------------------------------------------
// getDataset
// ---------------------------------------------------------------------------

describe("getDataset", () => {
  it("returns null for nonexistent id", () => {
    expect(getDataset(USER_A, "nonexistent_id")).toBeNull();
  });

  it("returns the dataset for a valid id", () => {
    const created = createDataset(USER_A, { name: "find-me" });
    const fetched = getDataset(USER_A, created.dataset_id);
    expect(fetched).not.toBeNull();
    expect(fetched!.dataset_id).toBe(created.dataset_id);
  });

  it("returns null when id belongs to a different user", () => {
    const created = createDataset(USER_A, { name: "private" });
    expect(getDataset(USER_B, created.dataset_id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateDataset
// ---------------------------------------------------------------------------

describe("updateDataset", () => {
  it("returns null for nonexistent id", () => {
    expect(updateDataset(USER_A, "nonexistent_id", { name: "x" })).toBeNull();
  });

  it("returns AdageData with same dataset_id after update", () => {
    const created = createDataset(USER_A, { name: "old-name" });
    const updated = updateDataset(USER_A, created.dataset_id, {
      name: "new-name",
    });
    expect(updated).not.toBeNull();
    expect(updated!.dataset_id).toBe(created.dataset_id);
  });

  it("persists name and description updates in metadata", () => {
    const created = createDataset(USER_A, { name: "original" });
    updateDataset(USER_A, created.dataset_id, {
      name: "updated",
      description: "new-desc",
    });
    const meta = getMetadataTable()[USER_A][0];
    expect(meta.name).toBe("updated");
    expect(meta.description).toBe("new-desc");
  });

  it("persists companies and sector updates in metadata filters", () => {
    const created = createDataset(USER_A, { name: "ds" });
    updateDataset(USER_A, created.dataset_id, {
      companies: ["TSLA"],
      sector: "Finance",
    });
    const meta = getMetadataTable()[USER_A][0];
    expect(meta.filters?.companies).toEqual(["TSLA"]);
    expect(meta.filters?.sector).toBe("Finance");
  });

  it("returns null when id belongs to a different user", () => {
    const created = createDataset(USER_A, { name: "ds" });
    expect(
      updateDataset(USER_B, created.dataset_id, { name: "hacked" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteDataset
// ---------------------------------------------------------------------------

describe("deleteDataset", () => {
  it("returns 0 for nonexistent id", () => {
    expect(deleteDataset(USER_A, "nonexistent_id")).toBe(0);
  });

  it("returns 1 and removes the dataset", () => {
    const created = createDataset(USER_A, { name: "to-delete" });
    expect(deleteDataset(USER_A, created.dataset_id)).toBe(1);
    expect(getDataset(USER_A, created.dataset_id)).toBeNull();
  });

  it("returns 0 when id belongs to a different user", () => {
    const created = createDataset(USER_A, { name: "ds" });
    expect(deleteDataset(USER_B, created.dataset_id)).toBe(0);
  });

  it("does not affect other datasets after deletion", () => {
    const a = createDataset(USER_A, { name: "keep" });
    const b = createDataset(USER_A, { name: "remove" });
    deleteDataset(USER_A, b.dataset_id);
    expect(getDatasets(USER_A)).toHaveLength(1);
    expect(getDatasets(USER_A)[0].dataset_id).toBe(a.dataset_id);
  });
});

// ---------------------------------------------------------------------------
// fetchEvents
// ---------------------------------------------------------------------------

describe("fetchEvents", () => {
  it("returns null for nonexistent dataset", async () => {
    const result = await fetchEvents(USER_A, "nonexistent_id", {});
    expect(result).toBeNull();
  });

  it("returns count 0 when no symbols available", async () => {
    const ds = createDataset(USER_A, { name: "no-symbols" });
    const result = await fetchEvents(USER_A, ds.dataset_id, {});
    expect(result).not.toBeNull();
    expect(result!.count).toBe(0);
    expect(result!.dataset.events).toEqual([]);
  });

  it("fetches events using companies from request body", async () => {
    const mockEvents = [makeEvent("AAPL", "2025-01-01")];
    jest
      .spyOn(marketstackService, "getMarketstackEod")
      .mockResolvedValue(mockEvents);

    const ds = createDataset(USER_A, { name: "test" });
    const result = await fetchEvents(USER_A, ds.dataset_id, {
      companies: ["AAPL"],
    });

    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.dataset.events).toHaveLength(1);
    expect(result!.dataset.events[0].attribute.symbol).toBe("AAPL");
  });

  it("falls back to metadata companies when body has no companies", async () => {
    const mockEvents = [
      makeEvent("TSLA", "2025-01-01"),
      makeEvent("TSLA", "2025-01-02"),
    ];
    jest
      .spyOn(marketstackService, "getMarketstackEod")
      .mockResolvedValue(mockEvents);

    const ds = createDataset(USER_A, {
      name: "with-companies",
      companies: ["TSLA"],
    });
    const result = await fetchEvents(USER_A, ds.dataset_id, {});

    expect(result!.count).toBe(2);
    expect(result!.dataset.events).toHaveLength(2);
  });

  it("appends events to existing store on repeated fetches", async () => {
    jest
      .spyOn(marketstackService, "getMarketstackEod")
      .mockResolvedValueOnce([makeEvent("AAPL", "2025-01-01")])
      .mockResolvedValueOnce([makeEvent("AAPL", "2025-01-02")]);

    const ds = createDataset(USER_A, { name: "append" });
    await fetchEvents(USER_A, ds.dataset_id, { companies: ["AAPL"] });
    const result = await fetchEvents(USER_A, ds.dataset_id, {
      companies: ["AAPL"],
    });

    expect(result!.count).toBe(1);
    expect(result!.dataset.events).toHaveLength(2);
  });

  it("passes date range to marketstack", async () => {
    const spy = jest
      .spyOn(marketstackService, "getMarketstackEod")
      .mockResolvedValue([]);

    const ds = createDataset(USER_A, { name: "ds" });
    await fetchEvents(USER_A, ds.dataset_id, {
      companies: ["AAPL"],
      start_date: "2025-01-01",
      end_date: "2025-01-31",
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        symbols: ["AAPL"],
        date_from: "2025-01-01",
        date_to: "2025-01-31",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// removeEvents
// ---------------------------------------------------------------------------

describe("removeEvents", () => {
  it("returns null for nonexistent dataset", () => {
    expect(removeEvents(USER_A, "nonexistent_id")).toBeNull();
  });

  it("returns 0 for a dataset with no events", () => {
    const ds = createDataset(USER_A, { name: "empty" });
    expect(removeEvents(USER_A, ds.dataset_id)).toBe(0);
  });

  it("removes all events when no body provided", () => {
    const ds = createDataset(USER_A, { name: "ds" });
    setDataStore({
      dataset_id: ds.dataset_id,
      events: [
        makeEvent("AAPL", "2025-01-01"),
        makeEvent("MSFT", "2025-01-02"),
      ],
    });
    const count = removeEvents(USER_A, ds.dataset_id);
    expect(count).toBe(2);
    expect(getDataset(USER_A, ds.dataset_id)!.events).toHaveLength(0);
  });

  it("removes events within the date range", () => {
    const ds = createDataset(USER_A, { name: "ds" });
    setDataStore({
      dataset_id: ds.dataset_id,
      events: [
        makeEvent("AAPL", "2025-01-01"),
        makeEvent("AAPL", "2025-01-15"),
        makeEvent("AAPL", "2025-02-01"),
      ],
    });
    const count = removeEvents(USER_A, ds.dataset_id, {
      start_date: "2025-01-10",
      end_date: "2025-01-20",
    });
    expect(count).toBe(1);
    expect(getDataset(USER_A, ds.dataset_id)!.events).toHaveLength(2);
  });

  it("keeps events outside the date range", () => {
    const ds = createDataset(USER_A, { name: "ds" });
    setDataStore({
      dataset_id: ds.dataset_id,
      events: [
        makeEvent("AAPL", "2025-01-01"),
        makeEvent("AAPL", "2025-03-01"),
      ],
    });
    removeEvents(USER_A, ds.dataset_id, {
      start_date: "2025-01-10",
      end_date: "2025-02-28",
    });
    const remaining = getDataset(USER_A, ds.dataset_id)!.events;
    expect(remaining).toHaveLength(2);
  });

  it("removes only matching companies within date range", () => {
    const ds = createDataset(USER_A, { name: "ds" });
    setDataStore({
      dataset_id: ds.dataset_id,
      events: [
        makeEvent("AAPL", "2025-01-10"),
        makeEvent("MSFT", "2025-01-10"),
        makeEvent("AAPL", "2025-01-11"),
      ],
    });
    const count = removeEvents(USER_A, ds.dataset_id, {
      start_date: "2025-01-01",
      end_date: "2025-01-31",
      companies: ["AAPL"],
    });
    expect(count).toBe(2);
    const remaining = getDataset(USER_A, ds.dataset_id)!.events;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].attribute.symbol).toBe("MSFT");
  });
});
