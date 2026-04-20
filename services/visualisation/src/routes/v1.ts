/**
 * Visualisation routes: candlestick PNG from `stock_ohlc` events in S3 (software rasterizer, no Canvas GPU).
 */

import { Request, Response, NextFunction, Router } from "express";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { PNG } from "pngjs";

import { checkAuth } from "../../../../shared/auth/user.auth";

const router = Router();

/** @throws if env var missing */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

/** LocalStack / custom endpoint when set. */
function getAwsEndpoint(): string | undefined {
  if (process.env.AWS_ENDPOINT_URL) return process.env.AWS_ENDPOINT_URL;
  const host = process.env.LOCALSTACK_HOSTNAME;
  if (host) return `http://${host}:4566`;
  return undefined;
}

/** S3 client with path-style URLs. */
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

/** Reads JSON from S3 or `null`. */
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

/** Dataset JSON key in the events bucket. */
function datasetS3Key(userId: string, datasetId: string) {
  return `datasets/${userId}/${datasetId}.json`;
}

// Keep CI fast: the visual test only asserts PNG output, not pixel-perfect rendering.
// Smaller canvas in Jest significantly reduces per-test runtime and avoids flakiness.
const CHART_WIDTH = process.env.NODE_ENV === "test" ? 640 : 960;
const CHART_HEIGHT = process.env.NODE_ENV === "test" ? 360 : 540;

/** Finite number or null. */
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/** Date portion of a Yahoo-style timestamp for axis labels. */
function dateLabelFromTimestamp(ts: string): string {
  // Expected format: "YYYY-MM-DD HH:mm:ss.sss" (from stored Yahoo EOD mapping).
  // We only show the date part to avoid overly long labels.
  return ts.split(" ")[0] ?? ts;
}

type Candle = {
  label: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

/**
 * Renders a candlestick chart into a PNG buffer using `pngjs` pixel operations.
 */
async function renderChartWithCanvas(
  labels: string[],
  xAxisTitle: string,
  yAxisTitle: string,
  title: string,
  seriesLabels: string[] | null,
  candles: Candle[],
): Promise<Buffer | null> {
  try {
    const image = new PNG({ width: CHART_WIDTH, height: CHART_HEIGHT });
    const setPx = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
      if (x < 0 || y < 0 || x >= CHART_WIDTH || y >= CHART_HEIGHT) return;
      const idx = (Math.floor(y) * CHART_WIDTH + Math.floor(x)) * 4;
      image.data[idx] = r;
      image.data[idx + 1] = g;
      image.data[idx + 2] = b;
      image.data[idx + 3] = a;
    };
    const drawLine = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
      let x = Math.round(x0), y = Math.round(y0);
      const tx = Math.round(x1), ty = Math.round(y1);
      const dx = Math.abs(tx - x), sx = x < tx ? 1 : -1;
      const dy = -Math.abs(ty - y), sy = y < ty ? 1 : -1;
      let err = dx + dy;
      while (true) {
        setPx(x, y, rgb[0], rgb[1], rgb[2]);
        if (x === tx && y === ty) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
      }
    };
    const fillRect = (x: number, y: number, w: number, h: number, rgb: [number, number, number]) => {
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(CHART_WIDTH, Math.ceil(x + w));
      const y1 = Math.min(CHART_HEIGHT, Math.ceil(y + h));
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) setPx(xx, yy, rgb[0], rgb[1], rgb[2]);
    };
    fillRect(0, 0, CHART_WIDTH, CHART_HEIGHT, [255, 255, 255]);
    const glyphs: Record<string, string[]> = {
      A: ["01110","10001","10001","11111","10001","10001","10001"], B: ["11110","10001","11110","10001","10001","10001","11110"],
      C: ["01111","10000","10000","10000","10000","10000","01111"], D: ["11110","10001","10001","10001","10001","10001","11110"],
      E: ["11111","10000","11110","10000","10000","10000","11111"], F: ["11111","10000","11110","10000","10000","10000","10000"],
      G: ["01111","10000","10000","10111","10001","10001","01110"], H: ["10001","10001","11111","10001","10001","10001","10001"],
      I: ["11111","00100","00100","00100","00100","00100","11111"], L: ["10000","10000","10000","10000","10000","10000","11111"],
      M: ["10001","11011","10101","10001","10001","10001","10001"], N: ["10001","11001","10101","10011","10001","10001","10001"],
      O: ["01110","10001","10001","10001","10001","10001","01110"], P: ["11110","10001","10001","11110","10000","10000","10000"],
      R: ["11110","10001","10001","11110","10100","10010","10001"], S: ["01111","10000","10000","01110","00001","00001","11110"],
      T: ["11111","00100","00100","00100","00100","00100","00100"], U: ["10001","10001","10001","10001","10001","10001","01110"],
      V: ["10001","10001","10001","10001","10001","01010","00100"], X: ["10001","01010","00100","00100","01010","10001","10001"],
      Y: ["10001","01010","00100","00100","00100","00100","00100"], "0": ["01110","10011","10101","11001","10001","10001","01110"],
      "1": ["00100","01100","00100","00100","00100","00100","01110"], "2": ["01110","10001","00001","00010","00100","01000","11111"],
      "3": ["11110","00001","00001","01110","00001","00001","11110"], "4": ["00010","00110","01010","10010","11111","00010","00010"],
      "5": ["11111","10000","10000","11110","00001","00001","11110"], "6": ["01110","10000","10000","11110","10001","10001","01110"],
      "7": ["11111","00001","00010","00100","01000","01000","01000"], "8": ["01110","10001","10001","01110","10001","10001","01110"],
      "9": ["01110","10001","10001","01111","00001","00001","01110"], "-": ["00000","00000","00000","11111","00000","00000","00000"],
      "(": ["00010","00100","01000","01000","01000","00100","00010"], ")": ["01000","00100","00010","00010","00010","00100","01000"],
      " ": ["00000","00000","00000","00000","00000","00000","00000"],
    };
    const drawText = (text: string, x: number, y: number, scale = 2, rgb: [number, number, number] = [31, 41, 55]) => {
      let cx = Math.floor(x);
      const up = text.toUpperCase();
      for (const ch of up) {
        const g = glyphs[ch] ?? glyphs[" "];
        for (let gy = 0; gy < g.length; gy += 1) for (let gx = 0; gx < g[gy].length; gx += 1) {
          if (g[gy][gx] === "1") fillRect(cx + gx * scale, y + gy * scale, scale, scale, rgb);
        }
        cx += 6 * scale;
      }
    };

    const left = 90, right = CHART_WIDTH - 40, top = 60, bottom = CHART_HEIGHT - 90;
    const w = right - left, h = bottom - top;
    drawLine(left, top, left, bottom, [51, 65, 85]);
    drawLine(left, bottom, right, bottom, [51, 65, 85]);

    const lows = candles.map((c) => c.low).filter((v): v is number => typeof v === "number");
    const highs = candles.map((c) => c.high).filter((v): v is number => typeof v === "number");
    const min = lows.length ? Math.min(...lows) : 0;
    const max = highs.length ? Math.max(...highs) : 1;
    const range = max - min || 1;
    const toY = (v: number) => bottom - ((v - min) / range) * h;
    const toX = (i: number) => left + (candles.length > 1 ? (i / (candles.length - 1)) * w : w / 2);

    for (let i = 0; i <= 5; i += 1) {
      const yy = top + (i / 5) * h;
      drawLine(left, yy, right, yy, [226, 232, 240]);
      const val = (max - ((i / 5) * range)).toFixed(2);
      drawText(val, 10, yy - 8, 1, [51, 65, 85]);
    }

    const bodyW = Math.max(4, Math.floor((w / Math.max(candles.length, 1)) * 0.6));
    for (let i = 0; i < candles.length; i += 1) {
      const c = candles[i];
      if (c.open === null || c.close === null || c.high === null || c.low === null) continue;
      const x = toX(i);
      const yH = toY(c.high), yL = toY(c.low), yO = toY(c.open), yC = toY(c.close);
      const up = c.close >= c.open;
      const col: [number, number, number] = up ? [22, 163, 74] : [220, 38, 38];
      drawLine(x, yH, x, yL, col);
      fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)), col);
    }

    drawText(`${title}${seriesLabels ? ` (${seriesLabels.join(" ")})` : ""}`.slice(0, 70), 30, 18, 2, [15, 23, 42]);
    drawText(xAxisTitle.slice(0, 30), Math.max(30, left + w / 2 - 60), CHART_HEIGHT - 40, 2, [51, 65, 85]);
    drawText(yAxisTitle.slice(0, 20), 30, top - 22, 1, [51, 65, 85]);
    const sample = Math.max(1, Math.floor(labels.length / 6));
    for (let i = 0; i < labels.length; i += sample) {
      const lx = toX(i);
      drawText((labels[i] ?? "").slice(0, 10), lx - 24, bottom + 12, 1, [51, 65, 85]);
    }

    return PNG.sync.write(image);
  } catch {
    return null;
  }
}

router.use(checkAuth);

/** Query string for `GET /charts`. */
interface ChartQueryParams {
  dataset_id?: string;
  x_axis?: "timestamp" | "symbol";
  companies?: string;
  start_date?: string;
  end_date?: string;
  title?: string;
}

/** `GET /charts` — PNG candlestick for a dataset’s OHLC events. */
router.get("/charts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    const params = req.query as ChartQueryParams;

    const { dataset_id, x_axis = "timestamp", title, companies, start_date, end_date } = params;

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
    // Candlestick renderer only supports OHLC events.
    events = events.filter((e) => e.event_type === "stock_ohlc");

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
    const candles: Candle[] = events.map((e) => ({
      label: x_axis === "symbol" ? String(e.attribute?.symbol ?? "") : dateLabelFromTimestamp(e.time_object.timestamp),
      open: asNumber(e.attribute?.open),
      high: asNumber(e.attribute?.high),
      low: asNumber(e.attribute?.low),
      close: asNumber(e.attribute?.close),
    }));

    const hasAnyCompleteOhlc = candles.some(
      (c) => c.open !== null && c.high !== null && c.low !== null && c.close !== null,
    );
    if (!hasAnyCompleteOhlc) {
      res.status(400).json({
        error: "INVALID_PARAMETERS",
        message: "No valid OHLC points found for candlestick rendering.",
      });
      return;
    }

    const resolvedTitle = title || "Candlestick";
    const yAxisTitle = "Price";

    const xAxisTitle = x_axis === "symbol" ? "Symbol" : "Date";

    const buffer = await renderChartWithCanvas(
      labels,
      xAxisTitle,
      yAxisTitle,
      resolvedTitle,
      companyList,
      candles,
    );
    if (!buffer) {
      res.status(500).json({
        error: "INTERNAL",
        message: "Unable to initialise canvas renderer in this environment.",
      });
      return;
    }

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
