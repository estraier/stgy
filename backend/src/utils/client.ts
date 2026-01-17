import { Config } from "../config";
import http from "http";
import https from "https";

export type HttpResult = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

function buildApiUrl(path: string): URL {
  const base = Config.BACKEND_API_BASE_URL.trim();
  if (!base) {
    throw new Error("Config.BACKEND_API_BASE_URL is empty");
  }
  const baseDir = base.endsWith("/") ? base : `${base}/`;
  const p = path.replace(/^\/+/, "");
  return new URL(p, baseDir);
}

function toCookieHeader(sessionCookie: string): string {
  const s = String(sessionCookie ?? "").trim();
  if (!s) throw new Error("sessionCookie is empty");
  if (s.includes("=")) return s;
  return `session_id=${s}`;
}

function truncateForError(s: string, maxChars: number): string {
  const t = String(s ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "…";
}

export function httpRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResult> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const body = options.body ?? "";
  const url = buildApiUrl(path);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;
  const agent = isHttps ? httpsAgent : httpAgent;

  if (body.length > 0 && (method === "GET" || method === "HEAD")) {
    throw new Error(`body is not allowed for method ${method}`);
  }

  if (body.length > 0 && headers["Content-Length"] === undefined) {
    headers["Content-Length"] = Buffer.byteLength(body).toString();
  }

  const timeoutMs = 30000;

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method,
        headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          const bodyStr = Buffer.concat(chunks).toString("utf8");
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: bodyStr });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("request timeout"));
    });

    req.on("error", reject);
    if (body.length > 0) req.write(body);
    req.end();
  });
}

export async function apiRequest(
  sessionCookie: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const method = options.method ?? "GET";
  let bodyStr = "";
  const headers: Record<string, string> = { Cookie: toCookieHeader(sessionCookie) };

  if (options.body !== undefined) {
    bodyStr = JSON.stringify(options.body);
    if (headers["Content-Type"] === undefined) headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
  }

  const res = await httpRequest(path, { method, headers, body: bodyStr });

  if (res.statusCode === 401) {
    throw new UnauthorizedError(`401 from ${path}`);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(
      `request failed: ${res.statusCode} ${method} ${path} ${truncateForError(res.body, 200)}`,
    );
  }
  return res;
}
