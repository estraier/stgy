import {
  classifyFrontendPath,
  classifyFrontendUrl,
  decodeHtmlEntities,
  extractLinkSnippetMetadata,
  formatLinkSnippetDate,
  makeMarkdownLinkSnippetMetadata,
  normalizeLinkSnippetUrl,
  truncateSnippetText,
} from "./linkSnippet";

describe("link snippet URL handling", () => {
  test("normalizes URL and removes fragment", () => {
    expect(normalizeLinkSnippetUrl(" https://EXAMPLE.com:443/a?b=1#part ").toString()).toBe(
      "https://example.com/a?b=1",
    );
  });

  test("rejects credentials, unsupported schemes, and non-standard ports", () => {
    expect(() => normalizeLinkSnippetUrl("ftp://example.com/a")).toThrow();
    expect(() => normalizeLinkSnippetUrl("https://user:pass@example.com/a")).toThrow();
    expect(() => normalizeLinkSnippetUrl("https://example.com:8443/a")).toThrow();
  });

  test("classifies supported relative frontend paths without an origin", () => {
    expect(
      classifyFrontendPath(new URL("/posts/19e9af4ccb800000", "https://stgy.invalid")),
    ).toEqual({ kind: "internal", target: { kind: "post", id: "19E9AF4CCB800000" } });
    expect(classifyFrontendPath(new URL("/admin", "https://stgy.invalid"))).toEqual({
      kind: "unsupported_internal",
    });
  });

  test("classifies only supported paths on the configured frontend origin", () => {
    const origins = ["https://stgy.jp"];
    expect(
      classifyFrontendUrl(new URL("https://stgy.jp/users/0001000000000021"), origins),
    ).toEqual({ kind: "internal", target: { kind: "user", id: "0001000000000021" } });
    expect(
      classifyFrontendUrl(new URL("https://stgy.jp/posts/19c6463fb8000000?x=1"), origins),
    ).toEqual({ kind: "internal", target: { kind: "post", id: "19C6463FB8000000" } });
    expect(classifyFrontendUrl(new URL("https://stgy.jp/admin"), origins)).toEqual({
      kind: "unsupported_internal",
    });
    expect(classifyFrontendUrl(new URL("https://cdn.stgy.jp/posts/19C6463FB8000000"), origins)).toEqual({
      kind: "external",
    });
  });
});

describe("link snippet text handling", () => {
  test("formats PostgreSQL Date values and ISO strings for fallback titles", () => {
    expect(formatLinkSnippetDate(new Date("2026-02-16T03:00:00.000Z"))).toBe("2026-02-16");
    expect(formatLinkSnippetDate("2026-02-16T12:00:00+09:00")).toBe("2026-02-16");
    expect(formatLinkSnippetDate("invalid")).toBeNull();
  });

  test("truncates by grapheme cluster and includes the ellipsis in the limit", () => {
    expect(truncateSnippetText("A👨‍👩‍👧‍👦BC", 3)).toBe("A👨‍👩‍👧‍👦…");
    expect(truncateSnippetText("  A\n  B  ", 10)).toBe("A B");
  });

  test("decodes numeric and common named HTML entities", () => {
    expect(decodeHtmlEntities("A &amp; B &#x1F600; &#169;")).toBe("A & B 😀 ©");
  });

  test("uses ordinary meta description without requiring OGP", () => {
    const html = `
      <html><head>
        <title>Normal &amp; useful title</title>
        <meta name="description" content="A normal > meta description">
        <meta name="application-name" content="Example App">
      </head></html>
    `;
    expect(
      extractLinkSnippetMetadata(html, "example.com", {
        title: 120,
        description: 240,
        siteName: 80,
      }),
    ).toEqual({
      title: "Normal & useful title",
      description: "A normal > meta description",
      siteName: "Example App",
    });
  });

  test("honors metadata priority independently for each field", () => {
    const html = `
      <title>HTML title</title>
      <meta content='Description from normal meta' name='description'>
      <meta content='Twitter title' name='twitter:title'>
      <meta property='og:title' content='OG title'>
      <meta property='og:site_name' content='OG site'>
    `;
    expect(
      extractLinkSnippetMetadata(html, "example.com", {
        title: 120,
        description: 240,
        siteName: 80,
      }),
    ).toEqual({
      title: "OG title",
      description: "Description from normal meta",
      siteName: "OG site",
    });
  });

  test("extracts STGY Markdown title and excludes metadata from description", () => {
    const markdown = `# Article title
-@author Someone
-@date 2026-08-01
Article body with **markup**.
`;
    expect(makeMarkdownLinkSnippetMetadata(markdown, { title: 120, description: 240 })).toEqual({
      title: "Article title",
      description: "Article body with markup.",
    });
  });
});
