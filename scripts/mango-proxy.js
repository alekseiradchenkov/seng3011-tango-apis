/**
 * Mango Proxy for LocalStack Lambdas.
 *
 * Why this exists:
 * LocalStack often rewrites/intercepts requests to `*.amazonaws.com` domains from
 * Lambda runtimes, which breaks calling *real* API Gateway endpoints like Mango.
 *
 * This proxy runs on the host and forwards `/mango/*` to the real Mango endpoint,
 * so Lambdas can call `http://host.docker.internal:<port>/mango/...` instead.
 *
 * Usage:
 *  node scripts/mango-proxy.js
 *
 * Env:
 *  MANGO_PROXY_PORT (default 8787)
 *  MANGO_TARGET_BASE (default https://x9rgu2z2vh.execute-api.us-east-1.amazonaws.com)
 */

const http = require("http");

const PORT = Number.parseInt(process.env.MANGO_PROXY_PORT ?? "8787", 10);
const TARGET_BASE = (process.env.MANGO_TARGET_BASE ??
  "https://x9rgu2z2vh.execute-api.us-east-1.amazonaws.com").replace(/\/+$/, "");

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (!url.pathname.startsWith("/mango/")) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }

    // Strip "/mango" prefix and forward.
    const forwardPath = url.pathname.replace(/^\/mango/, "") + url.search;
    const targetUrl = TARGET_BASE + forwardPath;

    const body = await readBody(req);

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers["content-length"];

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body.length > 0 ? body : undefined,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    const outHeaders = {};
    for (const [k, v] of upstream.headers.entries()) {
      if (k.toLowerCase() === "transfer-encoding") continue;
      outHeaders[k] = v;
    }
    outHeaders["content-length"] = String(buf.length);

    res.writeHead(upstream.status, outHeaders);
    res.end(buf);
  } catch (e) {
    sendJson(res, 500, { error: "PROXY_ERROR", message: String(e?.message ?? e) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`[mango-proxy] listening on 0.0.0.0:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[mango-proxy] forwarding /mango/* -> ${TARGET_BASE}/*`);
});

