import { AdageEvent, AdageTimeObject, AnyObject } from "./adage.type";

export type DatasetMetadata = {
  data_source: string;
  dataset_type: string;
  dataset_id: string;
  time_object: AdageTimeObject;
  user_id: string;
  name?: string;
  description?: string;
  filters?: Record<string, AnyObject>;
};

export type DatasetStore = {
  dataset_id: string;
  events: AdageEvent[];
};
