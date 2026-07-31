import { lookup } from "node:dns/promises";
import { BlockList, type LookupFunction } from "node:net";
import http from "node:http";
import https from "node:https";

export type RemoteImageFetchResult = {
  bytes: Uint8Array;
  contentType: string;
};

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type FetchOptions = {
  frontendOrigins: string[];
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

type RedirectResponse = {
  kind: "redirect";
  location: string;
};

type SuccessResponse = {
  kind: "success";
  bytes: Uint8Array;
  contentTypeHeader: string | null;
};

const REMOTE_IMAGE_BLOCKLIST = buildRemoteImageBlockList();
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

function buildRemoteImageBlockList(): BlockList {
  const list = new BlockList();
  list.addAddress("0.0.0.0", "ipv4");
  list.addSubnet("10.0.0.0", 8, "ipv4");
  list.addSubnet("100.64.0.0", 10, "ipv4");
  list.addSubnet("127.0.0.0", 8, "ipv4");
  list.addSubnet("169.254.0.0", 16, "ipv4");
  list.addSubnet("172.16.0.0", 12, "ipv4");
  list.addSubnet("192.0.0.0", 24, "ipv4");
  list.addSubnet("192.0.2.0", 24, "ipv4");
  list.addSubnet("192.168.0.0", 16, "ipv4");
  list.addSubnet("198.18.0.0", 15, "ipv4");
  list.addSubnet("198.51.100.0", 24, "ipv4");
  list.addSubnet("203.0.113.0", 24, "ipv4");
  list.addSubnet("224.0.0.0", 4, "ipv4");
  list.addSubnet("240.0.0.0", 4, "ipv4");

  list.addAddress("::", "ipv6");
  list.addAddress("::1", "ipv6");
  list.addSubnet("fc00::", 7, "ipv6");
  list.addSubnet("fe80::", 10, "ipv6");
  list.addSubnet("fec0::", 10, "ipv6");
  list.addSubnet("ff00::", 8, "ipv6");
  list.addSubnet("2001:db8::", 32, "ipv6");
  return list;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/\.+$/u, "").toLowerCase();
}

export function isSameHostOrSubdomain(hostname: string, baseHost: string): boolean {
  const host = normalizeHostname(hostname);
  const base = normalizeHostname(baseHost);
  return host === base || host.endsWith(`.${base}`);
}

export function normalizeIpAddress(address: string): string {
  const lower = address.trim().toLowerCase();
  if (lower.startsWith("::ffff:")) {
    return lower.slice("::ffff:".length);
  }
  return lower;
}

export function isBlockedRemoteAddress(address: string): boolean {
  const normalized = normalizeIpAddress(address);
  const family = normalized.includes(":") ? "ipv6" : "ipv4";
  return REMOTE_IMAGE_BLOCKLIST.check(normalized, family);
}

async function resolveHostAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  const out: ResolvedAddress[] = [];
  for (const row of rows) {
    if (row.family === 4 || row.family === 6) {
      out.push({ address: normalizeIpAddress(row.address), family: row.family });
    }
  }
  return out;
}

async function resolveFrontendOriginInfo(frontendOrigins: string[]): Promise<{
  hosts: string[];
  addresses: Set<string>;
}> {
  const hosts: string[] = [];
  const addresses = new Set<string>();
  for (const origin of frontendOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      continue;
    }
    const protocol = url.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") continue;
    const host = normalizeHostname(url.hostname);
    if (!host) continue;
    hosts.push(host);
    try {
      const resolved = await resolveHostAddresses(host);
      for (const row of resolved) {
        addresses.add(normalizeIpAddress(row.address));
      }
    } catch {
      // Ignore temporary lookup failures here; same-domain checks still apply.
    }
  }
  return { hosts, addresses };
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function sniffImageContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return "image/tiff";
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 1024)).trimStart();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && /<svg\b/i.test(text))) {
    return "image/svg+xml";
  }
  return null;
}

function chooseContentType(bytes: Uint8Array, headerValue: string | null): string {
  const headerType = headerValue ? headerValue.split(";")[0]?.trim().toLowerCase() : null;
  if (headerType && headerType.startsWith("image/")) return headerType;
  const sniffed = sniffImageContentType(bytes);
  if (sniffed) return sniffed;
  throw new Error("response is not an image");
}

export function createPinnedLookup(address: {
  address: string;
  family: 4 | 6;
}): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

function requestRemoteUrl(
  url: URL,
  address: ResolvedAddress,
  maxBytes: number,
  timeoutMs: number,
): Promise<RedirectResponse | SuccessResponse> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "image/*,*/*;q=0.8",
          "Accept-Encoding": "identity",
          "User-Agent": "STGY remote image importer",
        },
        lookup: createPinnedLookup(address),
        servername: url.protocol === "https:" ? url.hostname : undefined,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = firstHeaderValue(res.headers.location);
          res.resume();
          if (!location) {
            reject(new Error("redirect response missing location"));
            return;
          }
          resolve({ kind: "redirect", location });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`remote server responded with HTTP ${status}`));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error("remote image is too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const bytes = new Uint8Array(Buffer.concat(chunks));
          resolve({
            kind: "success",
            bytes,
            contentTypeHeader: firstHeaderValue(res.headers["content-type"]),
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("remote image request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function fetchRemoteImage(
  urlText: string,
  options: FetchOptions,
): Promise<RemoteImageFetchResult> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(urlText);
  } catch {
    throw new Error("invalid url");
  }
  if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
    throw new Error("only http and https urls are allowed");
  }

  const { hosts: frontendHosts, addresses: frontendAddresses } = await resolveFrontendOriginInfo(
    options.frontendOrigins,
  );

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const hostname = normalizeHostname(currentUrl.hostname);
    if (!hostname) throw new Error("invalid url host");
    for (const frontendHost of frontendHosts) {
      if (isSameHostOrSubdomain(hostname, frontendHost)) {
        throw new Error("remote image host is not allowed");
      }
    }

    const resolved = await resolveHostAddresses(hostname);
    if (!resolved.length) {
      throw new Error("remote image host could not be resolved");
    }
    for (const row of resolved) {
      if (isBlockedRemoteAddress(row.address)) {
        throw new Error("remote image address is not allowed");
      }
      if (frontendAddresses.has(normalizeIpAddress(row.address))) {
        throw new Error("remote image address is not allowed");
      }
    }

    const response = await requestRemoteUrl(currentUrl, resolved[0]!, options.maxBytes, timeoutMs);
    if (response.kind === "redirect") {
      currentUrl = new URL(response.location, currentUrl);
      continue;
    }

    return {
      bytes: response.bytes,
      contentType: chooseContentType(response.bytes, response.contentTypeHeader),
    };
  }

  throw new Error("too many redirects");
}
