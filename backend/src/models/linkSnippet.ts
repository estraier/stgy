export type LinkSnippetStatus = "ready" | "unavailable" | "fetch_failed" | "pending";

export type LinkSnippet = {
  url: string;
  status: LinkSnippetStatus;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  stale: boolean;
  refreshing: boolean;
};
