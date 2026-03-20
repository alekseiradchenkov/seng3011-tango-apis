import { Request, Response, NextFunction, Router } from "express";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { PNG } from "pngjs";

import { checkAuth } from "../../../../shared/auth/user.auth";

const router = Router();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function getAwsEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

function getS3Client() {
  const endpoint = getAwsEndpoint();
  return new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    endpoint,
    forcePathStyle: true,
  });
}

interface AdageEvent {
  time_object: { timestamp: string };
  attribute: Record<string, unknown>;
  event_type: string;
}

interface AdageData {
  events: AdageEvent[];
}

async function s3ReadJson<T>(bucket: string, key: string): Promise<T | null> {
  const s3 = getS3Client();
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await out.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function datasetS3Key(userId: string, datasetId: string) {
  return `datasets/${userId}/${datasetId}.json`;
}

const CHART_WIDTH = 960;
const CHART_HEIGHT = 540;

type ChartType = "line" | "bar";

async function tryRenderWithChartJs(
  labels: string[],
  dataPoints: Array<number | null>,
  type: ChartType,
  yAxis: string,
  title: string,
  companyList: string[] | null,
): Promise<Buffer | null> {
  try {
    // Lazy-load native canvas stack so Lambda can still start in environments
    // where native bindings are unavailable (e.g., some LocalStack setups).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ChartJSNodeCanvas } = require("chartjs-node-canvas") as {
      ChartJSNodeCanvas: new (opts: {
        width: number;
        height: number;
        backgroundColour: string;
      }) => { renderToBuffer: (config: unknown) => Promise<Buffer> };
    };

    const renderer = new ChartJSNodeCanvas({
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      backgroundColour: "white",
    });

    const chartConfig = {
      type,
      data: {
        labels,
        datasets: [
          {
            label: `${yAxis}${companyList ? ` (${companyList.join(", ")})` : ""}`,
            data: dataPoints,
            borderColor: "#2563eb",
            backgroundColor: type === "bar" ? "#2563eb" : "#2563eb33",
            tension: 0.3,
            fill: type === "line",
          },
        ],
      },
      options: {
        responsive: false,
        plugins: {
          title: {
            display: true,
            text: title,
            font: { size: 18 },
          },
          legend: {
            display: true,
            position: "top" as const,
          },
        },
        scales: {
          x: { title: { display: true, text: "Date" } },
          y: { title: { display: true, text: yAxis } },
        },
      },
    };

    return renderer.renderToBuffer(chartConfig);
  } catch {
    return null;
  }
}

function setPixel(
  png: PNG,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function drawLine(
  png: PNG,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
) {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;

  while (true) {
    setPixel(png, x, y, color[0], color[1], color[2]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function renderFallbackPng(
  dataPoints: Array<number | null>,
  type: ChartType,
): Buffer {
  const png = new PNG({ width: CHART_WIDTH, height: CHART_HEIGHT });
  const plotLeft = 80;
  const plotRight = CHART_WIDTH - 40;
  const plotTop = 40;
  const plotBottom = CHART_HEIGHT - 60;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  // white background
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      setPixel(png, x, y, 255, 255, 255, 255);
    }
  }

  // axes
  drawLine(png, plotLeft, plotTop, plotLeft, plotBottom, [55, 65, 81]);
  drawLine(png, plotLeft, plotBottom, plotRight, plotBottom, [55, 65, 81]);

  const values = dataPoints.filter((v): v is number => typeof v === "number");
  if (values.length === 0) return PNG.sync.write(png);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = plotWidth / Math.max(values.length - 1, 1);

  if (type === "bar") {
    const barWidth = Math.max(2, Math.floor(plotWidth / Math.max(values.length, 1) * 0.7));
    values.forEach((v, i) => {
      const xCenter = Math.floor(plotLeft + i * stepX);
      const yVal = Math.floor(plotBottom - ((v - min) / range) * plotHeight);
      for (let x = xCenter - Math.floor(barWidth / 2); x <= xCenter + Math.floor(barWidth / 2); x += 1) {
        drawLine(png, x, plotBottom, x, yVal, [37, 99, 235]);
      }
    });
  } else {
    for (let i = 1; i < values.length; i += 1) {
      const x0 = Math.floor(plotLeft + (i - 1) * stepX);
      const y0 = Math.floor(plotBottom - ((values[i - 1] - min) / range) * plotHeight);
      const x1 = Math.floor(plotLeft + i * stepX);
      const y1 = Math.floor(plotBottom - ((values[i] - min) / range) * plotHeight);
      drawLine(png, x0, y0, x1, y1, [37, 99, 235]);
    }
  }

  return PNG.sync.write(png);
}

router.use(checkAuth);

interface ChartQueryParams {
  dataset_id?: string;
  type?: "line" | "bar";
  x_axis?: "timestamp" | "symbol";
  y_axis?: string;
  companies?: string;
  start_date?: string;
  end_date?: string;
  title?: string;
  series_event_type?: string;
}

router.get("/charts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    const params = req.query as ChartQueryParams;

    const {
      dataset_id,
      type = "line",
      x_axis = "timestamp",
      y_axis = "close",
      title,
      companies,
      start_date,
      end_date,
      series_event_type = "stock_ohlc",
    } = params;

    if (!dataset_id) {
      res.status(400).json({
        error: "INVALID_PARAMETERS",
        message: "dataset_id is required.",
      });
      return;
    }

    const eventsBucket = requireEnv("EVENTS_BUCKET");
    const data = await s3ReadJson<AdageData>(eventsBucket, datasetS3Key(userId, dataset_id));

    if (!data) {
      res.status(404).json({
        error: "DATASET_NOT_FOUND",
        message: "Invalid dataset id or no events found.",
      });
      return;
    }

    let events = data.events || [];
    events = events.filter((e) => e.event_type === series_event_type);

    if (start_date) {
      events = events.filter((e) => e.time_object.timestamp >= start_date);
    }
    if (end_date) {
      events = events.filter((e) => e.time_object.timestamp <= end_date);
    }

    const companyList = companies
      ? companies.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
      : null;
    if (companyList) {
      events = events.filter((e) => {
        const symbol = String(e.attribute?.symbol ?? "").toUpperCase();
        const bare = symbol.includes(".") ? symbol.split(".")[0] : symbol;
        return companyList.includes(symbol) || companyList.includes(bare);
      });
    }

    events.sort((a, b) => a.time_object.timestamp.localeCompare(b.time_object.timestamp));

    const labels = events.map((e) =>
      x_axis === "symbol"
        ? String(e.attribute?.symbol ?? "")
        : e.time_object.timestamp.split(" ")[0],
    );
    const dataPoints = events.map((e) => {
      const value = e.attribute?.[y_axis];
      return typeof value === "number" ? value : null;
    });

    const resolvedTitle = title || `${y_axis} over time`;
    const resolvedType: ChartType = type === "bar" ? "bar" : "line";
    const buffer =
      (await tryRenderWithChartJs(
        labels,
        dataPoints,
        resolvedType,
        y_axis,
        resolvedTitle,
        companyList,
      )) ?? renderFallbackPng(dataPoints, resolvedType);

    res.status(200).type("image/png").send(buffer);
  } catch (e) {
    next(e);
  }
});

router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Visualisation error:", err);
  res.status(500).json({ error: "INTERNAL", message: String((err as Error)?.message ?? err) });
});

export default router;
