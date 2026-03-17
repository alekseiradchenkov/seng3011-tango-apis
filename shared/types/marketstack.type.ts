export interface MarketstackEod {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adj_open: number;
  adj_high: number;
  adj_low: number;
  adj_close: number;
  adj_volume: number;
  split_factor: number;
  dividend: number;
  symbol: string;
  name: string;
  exchange: string;
  exchange_code: string;
  price_currency: string;
  date: string;
}

export interface MarketstackEodResponse {
  pagination: { limit: number; offset: number; count: number; total: number };
  data: MarketstackEod[];
}
