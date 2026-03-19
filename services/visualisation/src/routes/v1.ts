import { Request, Response, NextFunction, Router } from "express";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import { checkAuth } from "../../../../shared/auth/user.auth";
import { AuthRequest } from "../../../../shared/types/auth.type";

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

function getDdbDocClient() {
  const endpoint = getAwsEndpoint();
  const ddb = new DynamoDBClient({
    region: process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
    endpoint,
  });
  return DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

router.use(checkAuth);

// ---------------------------------------------------------------------------
// Stubs — not yet fully implemented; return empty/placeholder responses.
// ---------------------------------------------------------------------------

router.get("/events/summary", (_req: Request, res: Response) => {
  res.status(200).json({
    dataset_id: null,
    sectors: [],
    companies: [],
    recent_trends: [],
  });
});

router.get("/events/trends", (_req: Request, res: Response) => {
  res.status(200).json({
    event_count: 0,
    dataset: null,
  });
});

// ---------------------------------------------------------------------------
// Charts — DynamoDB-backed CRUD
// ---------------------------------------------------------------------------

router.post("/charts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as unknown as AuthRequest).userId;
    const { type, dataset_id, x_axis, y_axis, title, series } = req.body;

    if (!type || !dataset_id || !x_axis || !y_axis) {
      res.status(400).json({
        error: "INVALID_PARAMETERS",
        message: "type, dataset_id, x_axis, and y_axis are required.",
      });
      return;
    }

    const table = requireEnv("CHARTS_TABLE");
    const ddb = getDdbDocClient();

    const chart_id = `chr_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const chart = {
      chart_id,
      user_id: userId,
      type,
      dataset_id,
      x_axis,
      y_axis,
      ...(title !== undefined ? { title } : {}),
      series: Array.isArray(series) ? series : [],
      created_at: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({ TableName: table, Item: chart }));
    res.status(201).json(chart);
  } catch (e) {
    next(e);
  }
});

router.get("/charts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as unknown as AuthRequest).userId;
    const table = requireEnv("CHARTS_TABLE");
    const ddb = getDdbDocClient();

    const out = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "user_id = :uid",
        ExpressionAttributeValues: { ":uid": userId },
      }),
    );

    res.status(200).json(out.Items ?? []);
  } catch (e) {
    next(e);
  }
});

router.get("/charts/:chartId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = requireEnv("CHARTS_TABLE");
    const ddb = getDdbDocClient();

    const out = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { chart_id: req.params.chartId },
      }),
    );

    if (!out.Item) {
      res.status(404).json({ error: "CHART_NOT_FOUND", message: "Invalid chart id." });
      return;
    }

    res.status(200).json(out.Item);
  } catch (e) {
    next(e);
  }
});

router.delete("/charts/:chartId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = requireEnv("CHARTS_TABLE");
    const ddb = getDdbDocClient();

    const existing = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { chart_id: req.params.chartId },
      }),
    );

    if (!existing.Item) {
      res.status(404).json({ error: "CHART_NOT_FOUND", message: "Invalid chart id." });
      return;
    }

    await ddb.send(new DeleteCommand({ TableName: table, Key: { chart_id: req.params.chartId } }));
    res.status(200).json({ count: 1 });
  } catch (e) {
    next(e);
  }
});

router.get("/charts/:chartId/render", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = requireEnv("CHARTS_TABLE");
    const ddb = getDdbDocClient();

    const out = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { chart_id: req.params.chartId },
      }),
    );

    if (!out.Item) {
      res.status(404).json({ error: "CHART_NOT_FOUND", message: "Invalid chart id." });
      return;
    }

    res.status(200).type("text/html").send(buildChartHtml(out.Item));
  } catch (e) {
    next(e);
  }
});

function buildChartHtml(chart: Record<string, unknown>): string {
  const title = chart.title ?? `${chart.y_axis} over ${chart.x_axis}`;
  const seriesJson = JSON.stringify(chart.series ?? []);
  const chartType = JSON.stringify(chart.type ?? "line");
  const xLabel = JSON.stringify(chart.x_axis ?? "x");
  const yLabel = JSON.stringify(chart.y_axis ?? "y");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: sans-serif; padding: 24px; background: #f5f5f5; margin: 0; }
    h2 { color: #1e293b; margin-bottom: 4px; }
    p.meta { color: #64748b; font-size: 0.875rem; margin-bottom: 20px; }
    .chart-container { background: white; border-radius: 8px; padding: 20px;
                       max-width: 960px; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  </style>
</head>
<body>
  <h2>${title}</h2>
  <p class="meta">Dataset: ${chart.dataset_id} &nbsp;|&nbsp; Chart: ${chart.chart_id}</p>
  <div class="chart-container">
    <canvas id="chart"></canvas>
  </div>
  <script>
    const series = ${seriesJson};
    const colors = ['#2563eb','#dc2626','#16a34a','#d97706','#7c3aed','#0891b2'];
    const datasets = series.map((s, i) => ({
      label: s.label,
      data: s.data.map(p => ({ x: p.x, y: p.y })),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '33',
      tension: 0.3,
      fill: false,
    }));
    new Chart(document.getElementById('chart'), {
      type: ${chartType},
      data: { datasets },
      options: {
        responsive: true,
        scales: {
          x: { type: 'category', title: { display: true, text: ${xLabel} } },
          y: { title: { display: true, text: ${yLabel} } },
        },
      },
    });
  </script>
</body>
</html>`;
}

router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Visualisation error:", err);
  res.status(500).json({ error: "INTERNAL", message: String((err as Error)?.message ?? err) });
});

export default router;
