export type AdageTimeObject = {
  timestamp: string;
  timezone: string;
  duration?: number;
  duration_unit?: string;
};

export type AnyValue =
  | string
  | number
  | boolean
  | null
  | AnyObject
  | AnyValue[];

export type AnyObject = { [key: string]: AnyValue };

export type AdageAttribute = AnyValue;
export type AdageAttributes = Record<string, AdageAttribute>;

export type AdageEvent = {
  time_object: AdageTimeObject;
  event_type: string;
  attribute: AdageAttributes;
};

export type AdageEvents = AdageEvent[];

export type AdageData = {
  data_source: string;
  dataset_type: string;
  dataset_id: string;
  time_object: AdageTimeObject;
  events: AdageEvents;
};
