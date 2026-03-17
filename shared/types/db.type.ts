import { AdageEvent, AdageTimeObject, AnyValue } from "./adage.type";
import { Chart } from "./chart.type";

export type DatasetMetadata = {
  data_source: string;
  dataset_type: string;
  dataset_id: string;
  time_object: AdageTimeObject;
  user_id: string;
  name?: string;
  description?: string;
  filters?: DatasetFilters;
};

export type ChartMetadata = {
  chart_id: string;
  user_id: string;
  time_object: AdageTimeObject;
  filters?: ChartFilters;
}

export type DatasetStore = {
  dataset_id: string;
  events: AdageEvent[];
};

export type DatasetFilters = Record<string, AnyValue>;
export type ChartFilters = Record<string, AnyValue>;

/* user: UserDatasetMetadata object...*/
export type DatasetMetadataTable = Record<string, DatasetMetadata[]>;

/* dataset_id: DataStore object... */
export type DatasetStores = Record<string, DatasetStore>;

/* user: UserChartMetadata object... */
export type ChartMetadataTable = Record<string, ChartMetadata[]>;

/* chart_id: Chart object... */
export type ChartStores = Record<string, Chart>
