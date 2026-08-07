/** @jest-environment jsdom */

import type { LinkSnippet } from "@/api/models";
import {
  createLinkSnippetHydrator,
  planLinkSnippetReuse,
  reconcileLinkSnippetPreviews,
} from "./linkSnippetHydration";

function readySnippet(overrides: Partial<LinkSnippet> = {}): LinkSnippet {
  return {
    url: "https://example.com/article",
    status: "ready",
    title: "Fetched title",
    description: "Fetched description",
    siteName: "Example",
    imageUrl: null,
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

  test("hotlinks an allowed image without sending a referrer", async () => {
    document.body.innerHTML =
      '<div class="stgy-link-snippet"><a class="stgy-link-snippet-link" href="https://example.com/article">example</a></div>';
    const hydrate = createLinkSnippetHydrator(async () =>
      readySnippet({ imageUrl: "https://cdn.example.com/card.webp" }),
    );

    hydrate(document.body);
    await flushPromises();

    const anchor = document.querySelector<HTMLAnchorElement>(
      ".stgy-link-snippet-link",
    )!;
    const image = anchor.querySelector<HTMLImageElement>(
      ".stgy-link-snippet-image",
    )!;
    expect(anchor.classList).not.toContain("stgy-link-snippet-link-with-image");
    expect(image.classList).toContain("stgy-link-snippet-image-pending");
    expect(image.src).toBe("https://cdn.example.com/card.webp");
    expect(image.referrerPolicy).toBe("no-referrer");
    expect(image.loading).toBe("lazy");
    expect(image.decoding).toBe("async");

    image.dispatchEvent(new Event("load"));
    expect(anchor.classList).toContain("stgy-link-snippet-link-with-image");
    expect(image.classList).not.toContain("stgy-link-snippet-image-pending");
  });

  test("shows the no-image fallback when the image fails", async () => {
    document.body.innerHTML =
      '<div class="stgy-link-snippet"><a class="stgy-link-snippet-link" href="/posts/1234567890ABCDEF">post</a></div>';
    const hydrate = createLinkSnippetHydrator(async () =>
      readySnippet({
        imageUrl: "https://s3.stgy.jp/stgy-images/u1/thumbs/photo_image.webp",
      }),
    );

    hydrate(document.body);
    await flushPromises();

    const anchor = document.querySelector<HTMLAnchorElement>(
      ".stgy-link-snippet-link",
    )!;
    const image = anchor.querySelector<HTMLImageElement>(
      ".stgy-link-snippet-image",
    )!;
    image.dispatchEvent(new Event("error"));

    expect(image.getAttribute("src")).toBe("/data/no-image.svg");
    expect(anchor.querySelector(".stgy-link-snippet-image")).toBe(image);
    expect(anchor.classList).not.toContain("stgy-link-snippet-link-with-image");

    image.dispatchEvent(new Event("load"));
    expect(anchor.classList).toContain("stgy-link-snippet-link-with-image");
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


describe("link snippet preview reuse", () => {
  test("matches unchanged snippets in occurrence order", () => {
    expect(
      planLinkSnippetReuse(
        ["a", "same", "same"],
        ["same", "a", "same", "new"],
      ),
    ).toEqual([1, 0, 2, null]);
  });

  test("moves a rendered snippet into the next preview when source is unchanged", () => {
    document.body.innerHTML =
      '<div id="old"><div class="stgy-link-snippet" data-caption="Caption" data-hydrated="true" data-status="ready"><a class="stgy-link-snippet-link stgy-link-snippet-link-with-image" href="https://example.com/article"><img class="stgy-link-snippet-image" src="https://cdn.example.com/card.webp"><span class="stgy-link-snippet-body"><span class="stgy-link-snippet-title">Fixed title</span></span></a></div></div>' +
      '<div id="next"><p>changed text</p><div class="stgy-link-snippet" data-caption="Caption"><a class="stgy-link-snippet-link" href="https://example.com/article">Caption</a></div></div>';
    const oldRoot = document.getElementById("old")!;
    const nextRoot = document.getElementById("next")!;
    const oldAnchor = oldRoot.querySelector<HTMLAnchorElement>(".stgy-link-snippet-link")!;

    expect(reconcileLinkSnippetPreviews(oldRoot, nextRoot)).toBe(1);
    expect(nextRoot.querySelector(".stgy-link-snippet-link")).toBe(oldAnchor);
    expect(nextRoot.querySelector(".stgy-link-snippet-title")?.textContent).toBe(
      "Fixed title",
    );
    expect(
      nextRoot.querySelector<HTMLElement>(".stgy-link-snippet")?.dataset.hydrated,
    ).toBe("true");
  });

  test("does not reuse a snippet when its caption or URL changes", () => {
    document.body.innerHTML =
      '<div id="old"><div class="stgy-link-snippet" data-caption="Old" data-hydrated="true" data-status="ready"><a class="stgy-link-snippet-link" href="https://example.com/old"><span class="stgy-link-snippet-title">Old title</span></a></div></div>' +
      '<div id="next"><div class="stgy-link-snippet" data-caption="New"><a class="stgy-link-snippet-link" href="https://example.com/new">New</a></div></div>';

    expect(
      reconcileLinkSnippetPreviews(
        document.getElementById("old")!,
        document.getElementById("next")!,
      ),
    ).toBe(0);
    expect(document.querySelector("#next .stgy-link-snippet-title")).toBeNull();
  });
});
