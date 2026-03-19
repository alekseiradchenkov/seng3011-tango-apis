import {
  AdageData,
  AdageEvent,
  AnyValue,
} from "../../../../shared/types/adage.type";

import {
  ChartMetadata,
  ChartMetadataTable,
} from "../../../../shared/types/db.type";

import {
  getChartMetadataTable,
  getChartStores,
  getDataStores,
  getMetadataTable,
  setChartMetadataTable,
  setChartStore,
} from "../../../../shared/db/data.db";

import { Chart, ChartCreateInput } from "../../../../shared/types/chart.type";

import { nowTimeObject } from "../../../../shared/utils/time.util";
import { EvenTrendInput, EventSummary, EventTrend } from "../types/events.type";

export function getEventsSummary(datasetId: string): EventSummary | null {
  const dataStores = getDataStores();

  const dataset = dataStores[datasetId];

  if (!dataset) return null;

  const summary: EventSummary = {
    dataset_id: datasetId,
    recent_trends: dataset.events,
  };
  
  return summary;
}

export function getEventTrends(input: EvenTrendInput): EventTrend | null {
  const dataStores = getDataStores();
  const dataset = dataStores[input.dataset_id];
  if (!dataset) return null;

  const filteredEvents = dataset.events.filter((event) => {
    const eventDate = new Date(event.time_object.timestamp);
    const fromDate = input.date_from ? new Date(input.date_from) : null;
    const toDate = input.date_to ? new Date(input.date_to) : null;

    return (!fromDate || eventDate >= fromDate) && (!toDate || eventDate <= toDate);
  });

  const filteredDataset = { ...dataset, events: filteredEvents };

  const trend: EventTrend = {
    event_count: filteredEvents.length,
    dataset: filteredDataset,
  };

  return trend;
}

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