import { AdageEvents } from "../../../../shared/types/adage.type";
import { DatasetStore } from "../../../../shared/types/db.type";

export type EvenTrendInput = {
  dataset_id: string;
  date_from?: string;
  date_to?: string;
}

export type EventSummary = {
  dataset_id: string;
  // sectors: string[];
  // companies: string[];
  recent_trends: AdageEvents;
}

export type EventTrend = {
  event_count: number;
  dataset: DatasetStore;
}