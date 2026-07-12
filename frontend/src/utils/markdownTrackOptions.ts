export type TrackLayout = "default" | "grid" | "float-left" | "float-right";
export type TrackSize = "xs" | "s" | "m" | "l" | "xl";
export type TrackBaseLayer = "pale" | "std" | "photo" | "cycle" | "osm" | "topo";

export type MarkdownOptionToken = {
  key: string;
  value: string | null;
};

export type TrackMarkdownLineMatch = {
  leading: string;
  caption: string;
  url: string;
  options: string | null;
  trailing: string;
};

const TRACK_BASE_LAYERS: readonly TrackBaseLayer[] = [
  "pale",
  "std",
  "photo",
  "cycle",
  "osm",
  "topo",
];

export function parseTrackMarkdownLine(line: string): TrackMarkdownLineMatch | null {
  const match = line.match(/^(\s*)@\[([^\]]*)\]\s*\(([^)]+)\)(?:\s*\{([^}]*)\})?(\s*)$/u);
  if (!match) return null;
  return {
    leading: match[1] ?? "",
    caption: match[2] ?? "",
    url: match[3] ?? "",
    options: match[4] ?? null,
    trailing: match[5] ?? "",
  };
}

export function parseMarkdownOptions(options: string | null | undefined): MarkdownOptionToken[] {
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

export function buildTrackMarkdownLine(
  match: TrackMarkdownLineMatch,
  tokens: MarkdownOptionToken[],
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

export function updateTrackMarkdownLine(
  line: string,
  updater: (tokens: MarkdownOptionToken[]) => MarkdownOptionToken[],
): string | null {
  const match = parseTrackMarkdownLine(line);
  if (!match) return null;
  return buildTrackMarkdownLine(match, updater(parseMarkdownOptions(match.options)));
}

export function updateTrackLayoutOptions(
  tokens: MarkdownOptionToken[],
  layout: TrackLayout,
): MarkdownOptionToken[] {
  const hasGrid = tokens.some((token) => token.key === "grid");
  const floatToken = tokens.find((token) => token.key === "float");
  const current: TrackLayout = hasGrid
    ? "grid"
    : floatToken?.value === "left"
      ? "float-left"
      : floatToken?.value === "right"
        ? "float-right"
        : "default";
  let next = tokens.filter((token) => token.key !== "grid" && token.key !== "float");
  if (layout === current) return next;
  if (layout === "grid") {
    next = [...next, { key: "grid", value: null }];
  } else if (layout === "float-left") {
    next = [...next, { key: "float", value: "left" }];
  } else if (layout === "float-right") {
    next = [...next, { key: "float", value: "right" }];
  }
  return next;
}

export function updateTrackSizeOptions(
  tokens: MarkdownOptionToken[],
  size: TrackSize,
): MarkdownOptionToken[] {
  const sizeToken = tokens.find((token) => token.key === "size");
  const current = trackSizeFromOption(sizeToken?.value);
  let next = tokens.filter((token) => token.key !== "size");
  if (size === current) return next;
  const value = trackSizeOptionValue(size);
  if (value) next = [...next, { key: "size", value }];
  return next;
}

export function getTrackBaseValue(tokens: MarkdownOptionToken[]): string | null {
  return tokens.find((token) => token.key === "base")?.value ?? null;
}

export function getNextTrackBaseValue(current: string | null): TrackBaseLayer | null {
  if (current == null) return TRACK_BASE_LAYERS[0];
  const index = TRACK_BASE_LAYERS.indexOf(current as TrackBaseLayer);
  if (index === -1 || index === TRACK_BASE_LAYERS.length - 1) return null;
  return TRACK_BASE_LAYERS[index + 1] ?? null;
}

export function cycleTrackBaseOptions(tokens: MarkdownOptionToken[]): MarkdownOptionToken[] {
  const current = getTrackBaseValue(tokens);
  const nextValue = getNextTrackBaseValue(current);
  const next = tokens.filter((token) => token.key !== "base");
  if (!nextValue) return next;
  return [...next, { key: "base", value: nextValue }];
}

export function isTrackGraphDisabled(tokens: MarkdownOptionToken[]): boolean {
  return tokens.some((token) => token.key === "graph" && token.value === "false");
}

export function toggleTrackGraphOptions(tokens: MarkdownOptionToken[]): MarkdownOptionToken[] {
  const disabled = isTrackGraphDisabled(tokens);
  const next = tokens.filter((token) => token.key !== "graph");
  if (disabled) return next;
  return [...next, { key: "graph", value: "false" }];
}

function trackSizeFromOption(value: string | null | undefined): TrackSize {
  if (value === "xsmall") return "xs";
  if (value === "small") return "s";
  if (value === "large") return "l";
  if (value === "xlarge") return "xl";
  return "m";
}

function trackSizeOptionValue(size: TrackSize): string | null {
  if (size === "xs") return "xsmall";
  if (size === "s") return "small";
  if (size === "l") return "large";
  if (size === "xl") return "xlarge";
  return null;
}
