export type DatasetCreateInput = {
  name?: string;
  description?: string;
};

export type DatasetEventsQuery = {
  symbols: string[];
  exchange?: string;
  date_from?: string;
  date_to?: string;
  sort?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
};

export type DatasetPagination = {
  limit?: number;
  offset?: number;
};
