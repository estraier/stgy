import type { PubConfigExtensions, PubCommentsMode } from "../models/user";

export const PUB_CONFIG_EXTENSIONS_MAX_LENGTH = 4096;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

export function validatePubConfigExtensions(value: unknown): PubConfigExtensions {
  if (!isPlainObject(value)) throw new Error("invalid extensions");

  const shareButtons = value.shareButtons;
  if (shareButtons !== undefined) {
    if (!Array.isArray(shareButtons)) throw new Error("invalid extensions.shareButtons");
    const seen = new Set<string>();
    for (const id of shareButtons) {
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen.has(id)) {
        throw new Error("invalid extensions.shareButtons");
      }
      seen.add(id);
    }
  }

  const comments = value.comments;
  if (comments !== undefined) {
    if (!isPlainObject(comments)) throw new Error("invalid extensions.comments");
    const mode = comments.mode;
    if (mode !== undefined && mode !== "none" && mode !== "moderated" && mode !== "open") {
      throw new Error("invalid extensions.comments.mode");
    }
  }

  const analytics = value.analytics;
  if (analytics !== undefined) {
    if (!isPlainObject(analytics)) throw new Error("invalid extensions.analytics");
    for (const [provider, config] of Object.entries(analytics)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(provider) || !isPlainObject(config)) {
        throw new Error("invalid extensions.analytics");
      }
    }
    const googleAnalytics = analytics.googleAnalytics;
    if (googleAnalytics !== undefined) {
      if (!isPlainObject(googleAnalytics)) {
        throw new Error("invalid extensions.analytics.googleAnalytics");
      }
      const measurementId = googleAnalytics.measurementId;
      if (
        measurementId !== undefined &&
        (typeof measurementId !== "string" || countCharacters(measurementId) > 128)
      ) {
        throw new Error("invalid extensions.analytics.googleAnalytics.measurementId");
      }
    }
  }

  const json = JSON.stringify(value);
  if (countCharacters(json) > PUB_CONFIG_EXTENSIONS_MAX_LENGTH) {
    throw new Error("extensions too long");
  }
  return value as PubConfigExtensions;
}

export function serializePubConfigExtensions(value: PubConfigExtensions): string {
  const validated = validatePubConfigExtensions(value);
  return JSON.stringify(validated);
}

export function parsePubConfigExtensions(value: unknown): PubConfigExtensions {
  if (typeof value !== "string") throw new Error("invalid stored extensions");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("invalid stored extensions");
  }
  return validatePubConfigExtensions(parsed);
}

export function getPubCommentsMode(value: PubConfigExtensions): PubCommentsMode {
  const mode = value.comments?.mode;
  return mode === "moderated" || mode === "open" ? mode : "none";
}
