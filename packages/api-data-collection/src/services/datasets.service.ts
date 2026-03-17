import {
  AdageData,
  AdageEvent,
  AnyValue,
} from "../../../../shared/types/adage.type";

import {
  DatasetFilters,
  DatasetMetadata,
  DatasetMetadataTable,
} from "../../../../shared/types/db.type";

import {
  DatasetCreateInput,
  DatasetEventsQuery,
  DatasetPagination,
} from "../../../../shared/types/datasets.type";

import {
  getDataStores,
  getMetadataTable,
  setDataStore,
  setMetadataTable,
} from "../../../../shared/db/data.db";

import { nowTimeObject } from "../../../../shared/utils/time.util";

import { getMarketstackEod } from "./marketstack.service";

function getUserDataset(
  metadata: DatasetMetadataTable,
  userId: string,
  datasetId: string,
): DatasetMetadata | null {
  const datasets = metadata[userId];
  if (!datasets) return null;

  const dataset = datasets.find((i) => i.dataset_id === datasetId);
  return dataset ? dataset : null;
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

export function getDatasets(userId: string): DatasetMetadata[] {
  const metadata = getMetadataTable();
  const datasets = metadata[userId] ? metadata[userId] : [];

  return datasets;
}

export function createDataset(
  userId: string,
  input: DatasetCreateInput,
): DatasetMetadata {
  const metadata = getMetadataTable();

  const datasetId = `dataset_${userId}_${Date.now()}`;

  const filters: Record<string, AnyValue> = {};

  const out: DatasetMetadata = {
    data_source: "MarketStack",
    dataset_type: "daily_stock_ohcl_data",
    dataset_id: datasetId,
    time_object: nowTimeObject(),
    user_id: userId,
    name: input.name,
    description: input.description,
    filters: filters,
  };

  metadata[userId].push(out);
  setMetadataTable(metadata);

  setDataStore({ dataset_id: datasetId, events: [] });

  return out;
}

export function getDataset(
  userId: string,
  datasetId: string,
  pagination?: DatasetPagination,
): AdageData | null {
  const metadata = getMetadataTable();
  const dataset = getUserDataset(metadata, userId, datasetId);

  if (!dataset) return null;

  const dataStores = getDataStores();
  const dataStore = dataStores[datasetId];
  if (!dataStore) return null;

  const limit =
    pagination?.limit && pagination?.limit < 100 ? pagination?.limit : 100;
  const offset =
    pagination?.offset && pagination?.offset < limit ? pagination?.offset : 0;
  const events = dataStore.events.slice(offset, offset + limit);

  return toAdageData(dataset, events);
}

export function updateDataset(
  userId: string,
  datasetId: string,
  input: DatasetCreateInput,
): DatasetMetadata | null {
  const metadata = getMetadataTable();
  const dataset = getUserDataset(metadata, userId, datasetId);
  if (!dataset) return null;

  if (input.name) dataset.name = input.name;
  if (input.name) dataset.description = input.description;

  dataset.time_object = nowTimeObject();

  setMetadataTable(metadata);

  return dataset;
}

export function deleteDataset(userId: string, datasetId: string): number {
  const metadata = getMetadataTable();
  const datasets = metadata[userId];
  if (!datasets) return 0;

  datasets.splice(
    datasets.findIndex((i) => i.dataset_id === datasetId),
    1,
  );
  metadata[userId] = datasets;
  setMetadataTable(metadata);

  const dataStores = getDataStores();
  if (dataStores[datasetId]) {
    delete dataStores[datasetId];
  }

  return 1;
}

export async function fetchEvents(
  userId: string,
  datasetId: string,
  query: DatasetEventsQuery,
): Promise<{ count: number; dataset: AdageData } | null> {
  const metadata = getMetadataTable();
  const dataset = getUserDataset(metadata, userId, datasetId);
  if (!dataset) return null;

  const events = await getMarketstackEod({
    symbols: query.symbols,
    exchange: query.exchange,
    date_from: query.date_from,
    date_to: query.date_to,
    sort: query.sort,
    limit: query.limit,
    offset: query.offset,
  });

  setDataStore({ dataset_id: datasetId, events: events });

  dataset.time_object = nowTimeObject();

  const newFilters: DatasetFilters = {};

  newFilters.symbols = query.symbols;
  if (query.exchange) newFilters.exchange = query.exchange;
  if (query.date_from) newFilters.date_from = query.date_from;
  if (query.date_to) newFilters.date_to = query.date_to;
  if (query.sort) newFilters.sort = query.sort;
  if (query.limit) newFilters.limit = query.limit;
  if (query.offset) newFilters.offset = query.offset;

  dataset.filters = newFilters;

  setMetadataTable(metadata);

  return {
    count: events.length,
    dataset: toAdageData(dataset, events.slice(0, 100)),
  };
}

export function removeEvents(
  userId: string,
  datasetId: string,
  query?: DatasetEventsQuery,
): { count: number } | null {
  const metadata = getMetadataTable();
  const dataset = getUserDataset(metadata, userId, datasetId);
  if (!dataset) return null;

  const dataStores = getDataStores();
  const dataStore = dataStores[datasetId];

  const countBefore = dataStore.events.length;

  const newEvents = dataStore.events.filter((i) => {
    if (!query) return true;

    const symbolMatch =
      !query.symbols?.length ||
      query.symbols.includes(i.attribute.symbol as string);

    const exchangeMatch =
      !query.exchange || (i.attribute.exchange as string) === query.exchange;

    const dateFromMatch =
      !query.date_from ||
      (i.time_object.timestamp as string) >= query.date_from;

    const dateToMatch =
      !query.date_to || (i.time_object.timestamp as string) <= query.date_to;

    return !(symbolMatch && exchangeMatch && dateFromMatch && dateToMatch);
  });

  const countRemoved = countBefore - newEvents.length;

  setDataStore({ dataset_id: datasetId, events: newEvents });

  dataset.time_object = nowTimeObject();

  setMetadataTable(metadata);

  return { count: countRemoved };
}
