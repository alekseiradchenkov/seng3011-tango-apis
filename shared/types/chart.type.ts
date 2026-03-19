export type ChartCreateInput = {
  type: string;
  dataset_id: string;
  x_axis: string;
  y_axis: string;
  title?: string;
  series?: ChartSeries[];
}

export type Chart = {
  chart_id: string;
  type: string;
  dataset_id: string;
  x_axis: string;
  y_axis: string;
  title?: string;
  series: ChartSeries[];
}

export type ChartSeries = {
  label: string;
  data: ChartDataPoint[];
}

export type ChartDataPoint = {
  x: Date;
  y: number;
}
