import type { AgreementTermContent, SessionInfo } from "@/api/models";
import { getLocaleCandidates, normalizeLocale } from "@/utils/locale";

const DEFAULT_RETURN_PATH = "/posts";

export function needsAgreement(session: SessionInfo): boolean {
  return !session.userIsAdmin && session.requiredAgreementTermId !== null;
}

export function makeAgreementPageUrl(returnPath: string): string {
  const safeReturnPath = sanitizeAgreementReturnPath(returnPath);
  return `/user-agreement?next=${encodeURIComponent(safeReturnPath)}`;
}

export function sanitizeAgreementReturnPath(
  value?: string | null,
  fallback = DEFAULT_RETURN_PATH,
): string {
  const safeFallback = isSafeInternalPath(fallback) ? fallback : DEFAULT_RETURN_PATH;
  if (!value || !isSafeInternalPath(value)) return safeFallback;

  try {
    const base = "https://stgy.invalid";
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return safeFallback;
    if (parsed.pathname === "/user-agreement" || parsed.pathname.startsWith("/user-agreement/")) {
      return safeFallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return safeFallback;
  }
}

export function selectAgreementContent(
  contents: readonly AgreementTermContent[],
  locale?: string | null,
): AgreementTermContent | null {
  const normalizedContents = contents.map((content) => ({
    content,
    normalizedLocale: normalizeLocale(content.locale),
  }));

  for (const candidate of [...getLocaleCandidates(locale), "en"]) {
    const normalizedCandidate = normalizeLocale(candidate);
    const match = normalizedContents.find(
      (item) => item.normalizedLocale === normalizedCandidate,
    );
    if (match) return match.content;
  }

  return null;
}

function isSafeInternalPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
