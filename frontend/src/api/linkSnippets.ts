import { apiFetch, extractError } from "./client";
import type { LinkSnippet } from "./models";

export async function resolveLinkSnippet(url: string): Promise<LinkSnippet> {
  const res = await apiFetch("/link-snippets/resolve", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
