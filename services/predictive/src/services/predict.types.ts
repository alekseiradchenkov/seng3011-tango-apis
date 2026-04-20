export type TrainRequest = {
  dataset_id: string;
  horizon_days?: number;
  spike_threshold?: number;
  symbols?: string[];
  macro?: {
    cpi_start: string;
    cpi_end: string;
    unemp_start: string;
    unemp_end: string;
  };
};

export type TrainResponse = {
  model_id: string;
  trained_at: string;
  feature_list: string[];
  metrics: { auc: number; precision: number; recall: number };
};

export type PredictRequest = {
  dataset_id: string;
  model_id: string;
  as_of_date?: string; // YYYY-MM-DD
  use_mango?: boolean;
  grid_overlay?: {
    enabled: boolean;
    grid_exposed_symbols: string[];
  };
};

export type PredictResponse = {
  as_of: string;
  predictions: Array<{
    symbol: string;
    p_spike_7d: number;
    risk_level: "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";
    drivers: string[];
  }>;
};

export type ElectricityShockResponse = {
  generated_at: string;
  regions: Array<{
    region: string;
    current_price: number;
    price_30m: number;
    shock_score: number;
    level: "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";
  }>;
};

export type MacroSummaryResponse = {
  source: string;
  cpi_latest: { date: string; value: number; change: number } | null;
  unemp_latest: { date: string; value: number; change: number } | null;
  error?: string;
};
