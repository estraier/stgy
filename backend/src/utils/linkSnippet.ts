import {
  mdFindFeatured,
  mdRenderText,
  mdSeparateMetadata,
  mdSeparateTitle,
  mdStripRubyElements,
  parseMarkdown,
} from "stgy-markdown";

export type LinkSnippetMetadata = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
};

export type LinkSnippetImageUrlPolicy = {
  frontendOrigins: string[];
  storagePublicUrlPrefix: string;
};

export type InternalLinkTarget =
  | { kind: "user"; id: string }
  | { kind: "post"; id: string }
  | { kind: "pub"; id: string };

export type FrontendUrlClassification =
  | { kind: "external" }
  | { kind: "internal"; target: InternalLinkTarget }
  | { kind: "unsupported_internal" };

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "©",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
};

export function normalizeLinkSnippetUrl(urlText: string): URL {
  let url: URL;
  try {
    url = new URL(urlText.trim());
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http and https urls are allowed");
  }
  if (url.username || url.password) {
    throw new Error("url credentials are not allowed");
  }
  const port = url.port;
  if ((url.protocol === "http:" && port && port !== "80") ||
      (url.protocol === "https:" && port && port !== "443")) {
    throw new Error("url port is not allowed");
  }
  url.hash = "";
  return url;
}

export function classifyFrontendPath(url: URL): FrontendUrlClassification {
  const match = /^\/(users|posts|pub)\/([0-9a-fA-F]{16})\/?$/u.exec(url.pathname);
  if (!match) return { kind: "unsupported_internal" };
  const id = match[2]!.toUpperCase();
  switch (match[1]) {
    case "users":
      return { kind: "internal", target: { kind: "user", id } };
    case "posts":
      return { kind: "internal", target: { kind: "post", id } };
    case "pub":
      return { kind: "internal", target: { kind: "pub", id } };
    default:
      return { kind: "unsupported_internal" };
  }
}

export function classifyFrontendUrl(
  url: URL,
  frontendOrigins: string[],
): FrontendUrlClassification {
  const isFrontendOrigin = frontendOrigins.some((originText) => {
    try {
      return new URL(originText).origin === url.origin;
    } catch {
      return false;
    }
  });
  if (!isFrontendOrigin) return { kind: "external" };
  return classifyFrontendPath(url);
}

export function normalizeSnippetText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function truncateSnippetText(value: string, maxLength: number): string {
  const normalized = normalizeSnippetText(value);
  if (maxLength <= 0 || normalized === "") return "";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = Array.from(segmenter.segment(normalized), ({ segment }) => segment);
  if (segments.length <= maxLength) return normalized;
  if (maxLength === 1) return "…";
  return `${segments.slice(0, maxLength - 1).join("")}…`;
}

export function formatLinkSnippetDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoDate = /^(\d{4}-\d{2}-\d{2})/u.exec(trimmed)?.[1];
    if (isoDate) return isoDate;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  return null;
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));/giu, (whole, dec, hex, name) => {
    if (dec) {
      const codePoint = Number.parseInt(dec, 10);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    if (hex) {
      const codePoint = Number.parseInt(hex, 16);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return HTML_ENTITY_MAP[String(name).toLowerCase()] ?? whole;
  });
}

function isValidCodePoint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/gu, " ");
}

function cleanHtmlText(value: string): string {
  return normalizeSnippetText(decodeHtmlEntities(stripHtmlTags(value)));
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, "");
}

function isSameHostOrSubdomain(hostname: string, parentHostname: string): boolean {
  return hostname === parentHostname || hostname.endsWith(`.${parentHostname}`);
}

function getStorageOrigin(storagePublicUrlPrefix: string): string | null {
  try {
    const url = new URL(storagePublicUrlPrefix.replace(/\{bucket\}/gu, "bucket"));
    url.hostname = normalizeHostname(url.hostname);
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeLinkSnippetImageUrl(
  value: string,
  pageUrl: URL,
  policy: LinkSnippetImageUrlPolicy,
): string | null {
  let url: URL;
  try {
    url = new URL(decodeHtmlEntities(value).trim(), pageUrl);
  } catch {
    return null;
  }

  if (url.username || url.password) return null;

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) return null;
  url.hostname = hostname;

  const storageOrigin = getStorageOrigin(policy.storagePublicUrlPrefix);
  if (storageOrigin !== null && url.origin === storageOrigin) {
    url.hash = "";
    return url.toString();
  }

  if (url.protocol !== "https:") return null;
  if (url.port && url.port !== "443") return null;

  const denied = policy.frontendOrigins.some((originText) => {
    try {
      const frontendHostname = normalizeHostname(new URL(originText).hostname);
      return frontendHostname !== "" && isSameHostOrSubdomain(hostname, frontendHostname);
    } catch {
      return false;
    }
  });
  if (denied) return null;

  url.hash = "";
  return url.toString();
}

function parseTagAttributes(tagText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = tagText.replace(/^<\s*\/?\s*[a-z0-9:-]+/iu, "").replace(/\/?\s*>$/u, "");
  const attrPattern = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of body.matchAll(attrPattern)) {
    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!(name in attrs)) attrs[name] = value;
  }
  return attrs;
}


function findStartTags(html: string, tagName: string): string[] {
  const out: string[] = [];
  const lower = html.toLowerCase();
  const needle = `<${tagName.toLowerCase()}`;
  let offset = 0;
  while (offset < html.length) {
    const start = lower.indexOf(needle, offset);
    if (start < 0) break;
    const afterName = lower[start + needle.length];
    if (afterName && !/[\s/>]/u.test(afterName)) {
      offset = start + needle.length;
      continue;
    }
    let quote: string | null = null;
    let end = start + needle.length;
    for (; end < html.length; end++) {
      const ch = html[end]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        out.push(html.slice(start, end + 1));
        end += 1;
        break;
      }
    }
    offset = Math.max(start + needle.length, end);
  }
  return out;
}

export function extractLinkSnippetMetadata(
  html: string,
  pageUrl: URL,
  limits: { title: number; description: number; siteName: number },
  imagePolicy: LinkSnippetImageUrlPolicy,
): LinkSnippetMetadata {
  const metadata = new Map<string, string>();
  for (const tag of findStartTags(html, "meta")) {
    const attrs = parseTagAttributes(tag);
    const key = (attrs.property || attrs.name || "").trim().toLowerCase();
    const content = attrs.content;
    if (key && typeof content === "string" && content.trim() !== "" && !metadata.has(key)) {
      metadata.set(key, cleanHtmlText(content));
    }
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html);
  const titleCandidate =
    metadata.get("og:title") ||
    metadata.get("twitter:title") ||
    (titleMatch ? cleanHtmlText(titleMatch[1]!) : "");
  const descriptionCandidate =
    metadata.get("og:description") ||
    metadata.get("twitter:description") ||
    metadata.get("description") ||
    "";
  const siteNameCandidate =
    metadata.get("og:site_name") || metadata.get("application-name") || pageUrl.hostname;
  const imageCandidate =
    metadata.get("og:image:secure_url") ||
    metadata.get("og:image") ||
    metadata.get("og:image:url") ||
    metadata.get("twitter:image") ||
    metadata.get("twitter:image:src") ||
    "";

  const title = truncateSnippetText(titleCandidate, limits.title) || null;
  const description = truncateSnippetText(descriptionCandidate, limits.description) || null;
  const siteName = truncateSnippetText(siteNameCandidate, limits.siteName) || null;
  const imageUrl = imageCandidate
    ? normalizeLinkSnippetImageUrl(imageCandidate, pageUrl, imagePolicy)
    : null;
  return { title, description, siteName, imageUrl };
}

export type MarkdownLinkSnippetImageUrls = {
  imageUrl: string;
};

export function makeMarkdownLinkSnippetImageUrls(
  markdown: string,
  storagePublicUrlPrefix: string,
  imagesBucket: string,
): MarkdownLinkSnippetImageUrls | null {
  const featured = mdFindFeatured(parseMarkdown(markdown));
  if (!featured) return null;

  let src: string | null = null;
  for (const child of featured.children) {
    if (child.type !== "element" || child.tag !== "img") continue;
    const candidate = child.attrs?.src;
    if (typeof candidate === "string") src = candidate;
    break;
  }
  if (src === null) return null;

  const match =
    /^\/images\/([^/?#]+)\/masters\/((?:[^/?#]+\/)*)([^/?#]+?)(\.[^/?#]+)(?:[?#].*)?$/u.exec(
      src,
    );
  if (!match || !storagePublicUrlPrefix.includes("{bucket}")) return null;

  const prefix = storagePublicUrlPrefix.replace(/\{bucket\}/gu, imagesBucket);
  const makePublicUrl = (key: string): string =>
    `${prefix}${key.split("/").map(encodeURIComponent).join("/")}`;
  const thumbnailKey = `${match[1]}/thumbs/${match[2]}${match[3]}_image.webp`;
  return { imageUrl: makePublicUrl(thumbnailKey) };
}

export function makeMarkdownLinkSnippetMetadata(
  markdown: string,
  limits: { title: number; description: number },
): Pick<LinkSnippetMetadata, "title" | "description"> {
  let nodes = parseMarkdown(markdown);
  const titleSeparated = mdSeparateTitle(nodes);
  const metadataSeparated = mdSeparateMetadata(titleSeparated.otherNodes);
  nodes = metadataSeparated.otherNodes;
  const title = titleSeparated.title
    ? truncateSnippetText(titleSeparated.title, limits.title) || null
    : null;
  const descriptionText = mdRenderText(mdStripRubyElements(nodes));
  const description = truncateSnippetText(descriptionText, limits.description) || null;
  return { title, description };
}
