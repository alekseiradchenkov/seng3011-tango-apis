import {
  AdageData,
  AdageEvent,
  AnyValue,
} from "../../../../shared/types/adage.type";

import {
  ChartMetadata,
  ChartMetadataTable,
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
  getChartMetadataTable,
  getChartStores,
  getDataStores,
  getMetadataTable,
  setChartMetadataTable,
  setChartStore,
  setDataStore,
  setMetadataTable,
} from "../../../../shared/db/data.db";

import { Chart, ChartCreateInput } from "../../../../shared/types/chart.type";

import { nowTimeObject } from "../../../../shared/utils/time.util";

export function createChart(
  userId: string,
  input: ChartCreateInput
): string | null {
  const metadata = getChartMetadataTable();

  const charts = getChartStores();
  
  const chartId = `chart_${userId}_${Date.now()}`;

  const filters: Record<string, AnyValue> = {}

  const metadataEntry: ChartMetadata = {
    chart_id: chartId,
    user_id: userId,
    time_object: nowTimeObject(),
    filters: filters,
  };

  charts[chartId] = {chart_id: chartId, ...input, series: input.series || []};
  metadata[userId].push(metadataEntry);

  setChartMetadataTable(metadata);
  setChartStore(charts[chartId]);

  return chartId;
}

export function getCharts(userId: string): Chart[] | null {
  const charts = getChartStores();
  const metadata = getChartMetadataTable();

  const userCharts = metadata[userId];

  if (!userCharts) return null;

  return userCharts.map((i) => charts[i.chart_id]);
}

export function getChart(
    userId: string,
    chartId: string,
  ): Chart | null {
  const charts = getChartStores();
  const metadata = getChartMetadataTable();

  const userChart = getUserChart(metadata, userId, chartId);
  
  if (!userChart) return null;
  
  return charts[chartId];
}

function getUserChart(
    metadata: ChartMetadataTable,
    userId: string,
    chartId: string,
  ): ChartMetadata | null {
  const charts = metadata[userId];
  if (!charts) return null;

  const chart = charts.find((i) => i.chart_id === chartId);
  return chart ? chart : null;
}

export function deleteChart(
    userId: string,
    chartId: string
  ): boolean {
  const charts = getChartStores();
  const metadata = getChartMetadataTable();
  const userCharts = metadata[userId];

  const userChart = getUserChart(metadata, userId, chartId);
  
  if (!userChart) return false;

  userCharts.splice(userCharts.indexOf(userChart), 1);
  metadata[userId] = userCharts;
  setChartMetadataTable(metadata);
  
  const chart = charts[chartId];
  if (chart) {
    delete charts[chartId];
  }
  
  return true;
}