export function normalizeLocale(locale?: string | null): string | undefined {
  const normalizedSeparators = locale
    ?.trim()
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalizedSeparators) {
    return undefined;
  }
  try {
    return Intl.getCanonicalLocales(normalizedSeparators)[0];
  } catch {
    return undefined;
  }
}

export function getLocaleCandidates(locale?: string | null): readonly string[] {
  const normalizedLocale = normalizeLocale(locale);
  if (normalizedLocale === undefined) {
    return [];
  }
  const language = normalizedLocale.split("-")[0];
  return language === normalizedLocale
    ? [normalizedLocale]
    : [normalizedLocale, language];
}

export function getBrowserLocale(): string | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  const locale = navigator.languages?.find((candidate) => candidate.trim() !== "") ??
    navigator.language;
  return normalizeLocale(locale);
}
