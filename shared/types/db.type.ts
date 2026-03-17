import { AdageEvent, AdageTimeObject, AnyValue } from "./adage.type";

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

export type DatasetStore = {
  dataset_id: string;
  events: AdageEvent[];
};

export type DatasetFilters = Record<string, AnyValue>;

/* user: UserDatasetMetadata object...*/
export type DatasetMetadataTable = Record<string, DatasetMetadata[]>;

/* dataset_id: DataStore object... */
export type DatasetStores = Record<string, DatasetStore>;