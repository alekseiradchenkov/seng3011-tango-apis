import {
  DatasetStore,
  DatasetStores,
  DatasetMetadataTable,
  ChartStores,
  ChartMetadataTable,
} from "../types/db.type";

import { Chart } from "../types/chart.type";

let dataStores: DatasetStores = {};
let metadataTable: DatasetMetadataTable = {};
let chartStores: ChartStores = {};
let chartMetadataTable: ChartMetadataTable = {};

export function getDataStores(): DatasetStores {
  return dataStores;
}

export function getMetadataTable(): DatasetMetadataTable {
  return metadataTable;
}

export function getChartStores(): ChartStores {
  return chartStores;
}

export function getChartMetadataTable(): ChartMetadataTable {
  return chartMetadataTable;
}

export function setDataStore(newDataStore: DatasetStore) {
  dataStores[newDataStore.dataset_id] = newDataStore;
}

export function setMetadataTable(newMetadataTable: DatasetMetadataTable) {
  metadataTable = newMetadataTable;
}

export function setChartStore(newChartStore: Chart) {
  chartStores[newChartStore.chart_id] = newChartStore;
}

export function setChartMetadataTable(newChartMetadataTable: ChartMetadataTable) {
  chartMetadataTable = newChartMetadataTable;
}
