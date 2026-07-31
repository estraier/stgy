import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import {
  createPinnedLookup,
  isBlockedRemoteAddress,
  isSameHostOrSubdomain,
  normalizeIpAddress,
} from "./remoteImage";

export type ResolvedRemoteAddress = {
  address: string;
  family: 4 | 6;
};

export type RemoteHtmlFetchOptions = {
  frontendOrigins: string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  beforeRequest?: (input: {
    url: URL;
    addresses: ResolvedRemoteAddress[];
    selectedAddress: ResolvedRemoteAddress;
  }) => Promise<void>;
};

export type RemoteHtmlFetchResult = {
  finalUrl: URL;
  html: string | null;
  contentType: string | null;
};

type RedirectResponse = { kind: "redirect"; location: string };
type ContentResponse = {
  kind: "content";
  bytes: Uint8Array;
  headers: IncomingHttpHeaders;
};

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/\.+$/u, "").toLowerCase();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error("remote request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function resolveHostAddresses(hostname: string): Promise<ResolvedRemoteAddress[]> {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows
    .filter((row): row is { address: string; family: 4 | 6 } => row.family === 4 || row.family === 6)
    .map((row) => ({ address: normalizeIpAddress(row.address), family: row.family }));
}

function parseFrontendHosts(frontendOrigins: string[]): string[] {
  const hosts: string[] = [];
  for (const originText of frontendOrigins) {
    try {
      const origin = new URL(originText);
      if (origin.protocol !== "http:" && origin.protocol !== "https:") continue;
      const host = normalizeHostname(origin.hostname);
      if (host) hosts.push(host);
    } catch {
      // Invalid configured origins are ignored here.
    }
  }
  return hosts;
}

async function resolveFrontendAddresses(
  hosts: string[],
  timeoutMs: number,
): Promise<Set<string>> {
  const addresses = new Set<string>();
  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        return await withTimeout(resolveHostAddresses(host), timeoutMs);
      } catch {
        return [];
      }
    }),
  );
  for (const rows of results) {
    for (const row of rows) addresses.add(row.address);
  }
  return addresses;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function validateRemoteUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http and https urls are allowed");
  }
  if (url.username || url.password) throw new Error("url credentials are not allowed");
  if ((url.protocol === "http:" && url.port && url.port !== "80") ||
      (url.protocol === "https:" && url.port && url.port !== "443")) {
    throw new Error("url port is not allowed");
  }
}

function requestRemoteUrl(
  url: URL,
  address: ResolvedRemoteAddress,
  maxBytes: number,
  timeoutMs: number,
): Promise<RedirectResponse | ContentResponse> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: NodeJS.Timeout | undefined;
    const finish = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
    const succeed = (value: RedirectResponse | ContentResponse) => {
      if (settled) return;
      settled = true;
      finish();
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    };

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "identity",
          "User-Agent": "STGY link snippet resolver",
        },
        lookup: createPinnedLookup(address),
        servername: url.protocol === "https:" ? url.hostname : undefined,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = firstHeaderValue(res.headers.location);
          res.resume();
          if (!location) return fail(new Error("redirect response missing location"));
          return succeed({ kind: "redirect", location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return fail(new Error(`remote server responded with HTTP ${status}`));
        }

        const lengthHeader = firstHeaderValue(res.headers["content-length"]);
        if (lengthHeader && Number(lengthHeader) > maxBytes) {
          res.resume();
          return fail(new Error("remote response is too large"));
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            fail(new Error("remote response is too large"));
            req.destroy();
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", (error) => fail(error));
        res.on("end", () => {
          succeed({
            kind: "content",
            bytes: new Uint8Array(Buffer.concat(chunks)),
            headers: res.headers,
          });
        });
      },
    );

    timeoutId = setTimeout(
      () => req.destroy(new Error("remote request timed out")),
      Math.max(1, timeoutMs),
    );
    req.on("error", (error) => fail(error));
    req.end();
  });
}

function getContentType(headers: IncomingHttpHeaders): string | null {
  const value = firstHeaderValue(headers["content-type"]);
  return value ? value.split(";", 1)[0]!.trim().toLowerCase() : null;
}

function detectCharset(bytes: Uint8Array, headers: IncomingHttpHeaders): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";

  const contentType = firstHeaderValue(headers["content-type"]) ?? "";
  const headerMatch = /charset\s*=\s*["']?([^;\s"']+)/iu.exec(contentType);
  if (headerMatch) return normalizeCharset(headerMatch[1]!);

  const ascii = Buffer.from(bytes.slice(0, 8192)).toString("latin1");
  const metaCharset = /<meta\b[^>]*\bcharset\s*=\s*["']?([^\s"'/>]+)/iu.exec(ascii);
  if (metaCharset) return normalizeCharset(metaCharset[1]!);
  const metaContentType = /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([^\s;"']+)/iu.exec(ascii);
  if (metaContentType) return normalizeCharset(metaContentType[1]!);
  return "utf-8";
}

function normalizeCharset(value: string): string {
  const charset = value.trim().toLowerCase().replace(/_/gu, "-");
  if (charset === "utf8") return "utf-8";
  if (charset === "sjis" || charset === "shift-jis" || charset === "x-sjis") {
    return "shift_jis";
  }
  if (charset === "eucjp") return "euc-jp";
  return charset;
}

function decodeHtml(bytes: Uint8Array, headers: IncomingHttpHeaders): string {
  const charset = detectCharset(bytes, headers);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const sample = Buffer.from(bytes.slice(0, 1024)).toString("latin1").trimStart().toLowerCase();
  return sample.startsWith("<!doctype html") || sample.startsWith("<html") ||
    sample.startsWith("<head") || sample.startsWith("<meta") || sample.startsWith("<title");
}

export async function fetchRemoteHtml(
  initialUrl: URL,
  options: RemoteHtmlFetchOptions,
): Promise<RemoteHtmlFetchResult> {
  let currentUrl = new URL(initialUrl.toString());
  const deadline = Date.now() + options.timeoutMs;
  const frontendHosts = parseFrontendHosts(options.frontendOrigins);
  const initialHostname = normalizeHostname(currentUrl.hostname);
  if (frontendHosts.some((host) => isSameHostOrSubdomain(initialHostname, host))) {
    throw new Error("remote host is not allowed");
  }
  const frontendAddresses = await resolveFrontendAddresses(
    frontendHosts,
    Math.max(1, Math.min(500, Math.floor(options.timeoutMs / 4))),
  );

  for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount++) {
    validateRemoteUrl(currentUrl);
    const hostname = normalizeHostname(currentUrl.hostname);
    if (!hostname) throw new Error("invalid url host");
    if (frontendHosts.some((host) => isSameHostOrSubdomain(hostname, host))) {
      throw new Error("remote host is not allowed");
    }

    const dnsRemainingMs = deadline - Date.now();
    if (dnsRemainingMs <= 0) throw new Error("remote request timed out");
    const addresses = await withTimeout(resolveHostAddresses(hostname), dnsRemainingMs);
    if (addresses.length === 0) throw new Error("remote host could not be resolved");
    for (const row of addresses) {
      if (isBlockedRemoteAddress(row.address) || frontendAddresses.has(row.address)) {
        throw new Error("remote address is not allowed");
      }
    }

    const selectedAddress = addresses[0]!;
    await options.beforeRequest?.({ url: currentUrl, addresses, selectedAddress });
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("remote request timed out");
    const response = await requestRemoteUrl(currentUrl, selectedAddress, options.maxBytes, remainingMs);
    if (response.kind === "redirect") {
      currentUrl = new URL(response.location, currentUrl);
      continue;
    }

    const contentType = getContentType(response.headers);
    const isHtmlType = contentType === "text/html" || contentType === "application/xhtml+xml";
    if (!isHtmlType && contentType !== null && !looksLikeHtml(response.bytes)) {
      return { finalUrl: currentUrl, html: null, contentType };
    }
    if (contentType === null && !looksLikeHtml(response.bytes)) {
      return { finalUrl: currentUrl, html: null, contentType: null };
    }
    return {
      finalUrl: currentUrl,
      html: decodeHtml(response.bytes, response.headers),
      contentType,
    };
  }

  throw new Error("too many redirects");
}
