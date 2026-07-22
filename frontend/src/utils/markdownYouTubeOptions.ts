export type YouTubeSize = "xs" | "s" | "m" | "l" | "xl";

export type YouTubeOptionToken = {
  key: string;
  value: string | null;
};

export type YouTubeMarkdownLineMatch = {
  leading: string;
  caption: string;
  url: string;
  options: string | null;
  trailing: string;
};

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function isYouTubeUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  const pathParts = url.pathname.split("/").filter(Boolean);
  let videoId = "";

  if (host === "youtu.be") {
    videoId = pathParts[0] ?? "";
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else if (
      pathParts.length >= 2 &&
      ["embed", "shorts", "live", "v"].includes(pathParts[0] ?? "")
    ) {
      videoId = pathParts[1] ?? "";
    }
  }

  return YOUTUBE_VIDEO_ID_RE.test(videoId);
}

export function parseYouTubeMarkdownLine(line: string): YouTubeMarkdownLineMatch | null {
  const match = line.match(
    /^(\s*)@\[([^\]]*)\]\s*\(([^)]+)\)(?:\s*\{([^}]*)\})?(\s*)$/u,
  );
  if (!match) return null;
  const url = match[3] ?? "";
  if (!isYouTubeUrl(url)) return null;
  return {
    leading: match[1] ?? "",
    caption: match[2] ?? "",
    url,
    options: match[4] ?? null,
    trailing: match[5] ?? "",
  };
}

export function parseYouTubeOptions(
  options: string | null | undefined,
): YouTubeOptionToken[] {
  if (!options) return [];
  return options
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => {
      const separator = token.indexOf("=");
      if (separator === -1) {
        return { key: token, value: null };
      }
      const key = token.slice(0, separator).trim();
      const value = token.slice(separator + 1).trim();
      return { key, value: value || null };
    });
}

export function buildYouTubeMarkdownLine(
  match: YouTubeMarkdownLineMatch,
  tokens: YouTubeOptionToken[],
): string {
  const options = tokens
    .map((token) => {
      if (token.value == null || token.value === "") return token.key;
      return `${token.key}=${token.value}`;
    })
    .join(",");
  const optionsPart = options ? `{${options}}` : "";
  return `${match.leading}@[${match.caption}](${match.url})${optionsPart}${match.trailing}`;
}

export function updateYouTubeMarkdownLine(
  line: string,
  updater: (tokens: YouTubeOptionToken[]) => YouTubeOptionToken[],
): string | null {
  const match = parseYouTubeMarkdownLine(line);
  if (!match) return null;
  return buildYouTubeMarkdownLine(match, updater(parseYouTubeOptions(match.options)));
}

export function updateYouTubeSizeOptions(
  tokens: YouTubeOptionToken[],
  size: YouTubeSize,
): YouTubeOptionToken[] {
  const sizeToken = tokens.find((token) => token.key === "size");
  const current = sizeFromOption(sizeToken?.value);
  let next = tokens.filter((token) => token.key !== "size");
  if (size === current) return next;
  const value = sizeOptionValue(size);
  if (value) next = [...next, { key: "size", value }];
  return next;
}

function sizeFromOption(value: string | null | undefined): YouTubeSize {
  if (value === "xsmall") return "xs";
  if (value === "small") return "s";
  if (value === "large") return "l";
  if (value === "xlarge") return "xl";
  return "m";
}

function sizeOptionValue(size: YouTubeSize): string | null {
  if (size === "xs") return "xsmall";
  if (size === "s") return "small";
  if (size === "l") return "large";
  if (size === "xl") return "xlarge";
  return null;
}
