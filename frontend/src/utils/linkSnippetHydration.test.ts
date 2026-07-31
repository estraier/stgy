/** @jest-environment jsdom */

import type { LinkSnippet } from "@/api/models";
import { createLinkSnippetHydrator } from "./linkSnippetHydration";

function readySnippet(overrides: Partial<LinkSnippet> = {}): LinkSnippet {
  return {
    url: "https://example.com/article",
    status: "ready",
    title: "Fetched title",
    description: "Fetched description",
    siteName: "Example",
    fetchedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-02T00:00:00.000Z",
    stale: false,
    refreshing: false,
    ...overrides,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("link snippet hydration", () => {
  test("hydrates a snippet with fetched metadata", async () => {
    document.body.innerHTML =
      '<div id="root"><div class="stgy-link-snippet"><a class="stgy-link-snippet-link" href="https://example.com/article">https://example.com/article</a></div></div>';
    const resolver = jest.fn(async () => readySnippet());
    const hydrate = createLinkSnippetHydrator(resolver);

    hydrate(document.getElementById("root")!);
    await flushPromises();

    const snippet = document.querySelector<HTMLElement>(".stgy-link-snippet")!;
    expect(resolver).toHaveBeenCalledWith("https://example.com/article");
    expect(snippet.dataset.status).toBe("ready");
    expect(snippet.querySelector(".stgy-link-snippet-site-name")?.textContent).toBe(
      "Example",
    );
    expect(snippet.querySelector(".stgy-link-snippet-title")?.textContent).toBe(
      "Fetched title",
    );
    expect(snippet.querySelector(".stgy-link-snippet-description")?.textContent).toBe(
      "Fetched description",
    );
  });

  test("keeps an explicit caption as the title", async () => {
    document.body.innerHTML =
      '<div class="stgy-link-snippet" data-caption="My caption"><a class="stgy-link-snippet-link" href="/pub/12345">My caption</a></div>';
    const resolver = jest.fn(async () => readySnippet());
    const hydrate = createLinkSnippetHydrator(resolver);

    hydrate(document.body);
    await flushPromises();

    expect(resolver).toHaveBeenCalledWith("/pub/12345");
    expect(document.querySelector(".stgy-link-snippet-title")?.textContent).toBe(
      "My caption",
    );
  });

  test("keeps the fallback link when no snippet is available", async () => {
    document.body.innerHTML =
      '<div class="stgy-link-snippet"><a class="stgy-link-snippet-link" href="/pub/12345">/pub/12345</a></div>';
    const hydrate = createLinkSnippetHydrator(async () =>
      readySnippet({
        status: "unavailable",
        title: null,
        description: null,
      }),
    );

    hydrate(document.body);
    await flushPromises();

    const snippet = document.querySelector<HTMLElement>(".stgy-link-snippet")!;
    expect(snippet.dataset.status).toBe("unavailable");
    expect(snippet.querySelector("a")?.textContent).toBe("/pub/12345");
  });

  test("resolves duplicate URLs only once", async () => {
    document.body.innerHTML =
      '<div><div class="stgy-link-snippet"><a class="stgy-link-snippet-link" href="https://example.com/article">one</a></div><div class="stgy-link-snippet"><a class="stgy-link-snippet-link" href="https://example.com/article">two</a></div></div>';
    const resolver = jest.fn(async () => readySnippet());
    const hydrate = createLinkSnippetHydrator(resolver);

    hydrate(document.body);
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".stgy-link-snippet-title")).toHaveLength(2);
  });
});
