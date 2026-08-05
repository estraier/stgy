import {
  classifyFrontendPath,
  classifyFrontendUrl,
  decodeHtmlEntities,
  extractLinkSnippetMetadata,
  formatLinkSnippetDate,
  makeMarkdownLinkSnippetImageUrls,
  makeMarkdownLinkSnippetMetadata,
  normalizeLinkSnippetImageUrl,
  normalizeLinkSnippetUrl,
  truncateSnippetText,
} from "./linkSnippet";

const imagePolicy = {
  frontendOrigins: ["https://stgy.jp"],
  storagePublicUrlPrefix: "https://s3.stgy.jp/{bucket}/",
  imagesBucket: "stgy-images",
  profilesBucket: "stgy-profiles",
};

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
      extractLinkSnippetMetadata(
        html,
        new URL("https://example.com/article"),
        {
          title: 120,
          description: 240,
          siteName: 80,
        },
        imagePolicy,
      ),
    ).toEqual({
      title: "Normal & useful title",
      description: "A normal > meta description",
      siteName: "Example App",
      imageUrl: null,
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
      extractLinkSnippetMetadata(
        html,
        new URL("https://example.com/article"),
        {
          title: 120,
          description: 240,
          siteName: 80,
        },
        imagePolicy,
      ),
    ).toEqual({
      title: "OG title",
      description: "Description from normal meta",
      siteName: "OG site",
      imageUrl: null,
    });
  });

  test("extracts and resolves an allowed OGP image URL", () => {
    const html = `
      <title>Image article</title>
      <meta property="og:image" content="/images/card.jpg?x=1&amp;y=2#fragment">
    `;
    expect(
      extractLinkSnippetMetadata(
        html,
        new URL("https://example.com/posts/1"),
        {
          title: 120,
          description: 240,
          siteName: 80,
        },
        imagePolicy,
      ),
    ).toEqual({
      title: "Image article",
      description: null,
      siteName: "example.com",
      imageUrl: "https://example.com/images/card.jpg?x=1&y=2",
    });
  });

  test("allows the configured S3 origin and rejects other STGY hosts", () => {
    const pageUrl = new URL("https://example.com/article");
    expect(
      normalizeLinkSnippetImageUrl(
        "https://s3.stgy.jp/stgy-images/example.webp",
        pageUrl,
        imagePolicy,
      ),
    ).toBe("https://s3.stgy.jp/stgy-images/example.webp");
    expect(
      normalizeLinkSnippetImageUrl(
        "https://stgy.jp/search?q=expensive",
        pageUrl,
        imagePolicy,
      ),
    ).toBeNull();
    expect(
      normalizeLinkSnippetImageUrl(
        "https://s3-console.stgy.jp/",
        pageUrl,
        imagePolicy,
      ),
    ).toBeNull();
  });

  test("rejects the configured frontend domain and its subdomains on custom deployments", () => {
    const pageUrl = new URL("https://outside.example/article");
    const policy = {
      frontendOrigins: ["https://social.example.net"],
      storagePublicUrlPrefix: "https://media.example.net/{bucket}/",
      imagesBucket: "stgy-images",
      profilesBucket: "stgy-profiles",
    };
    expect(
      normalizeLinkSnippetImageUrl(
        "https://social.example.net/search?q=expensive",
        pageUrl,
        policy,
      ),
    ).toBeNull();
    expect(
      normalizeLinkSnippetImageUrl(
        "https://api.social.example.net/search?q=expensive",
        pageUrl,
        policy,
      ),
    ).toBeNull();
  });

  test("rewrites configured S3 image masters to thumbnails without a fixed hostname", () => {
    const pageUrl = new URL("https://example.com/article");
    expect(
      normalizeLinkSnippetImageUrl(
        "https://media.example.net/stgy-images/0001000000000021/masters/797491/abcdef0123456789.jpg?download=1",
        pageUrl,
        {
          frontendOrigins: ["https://social.example.net"],
          storagePublicUrlPrefix: "https://media.example.net/{bucket}/",
          imagesBucket: "stgy-images",
          profilesBucket: "stgy-profiles",
        },
      ),
    ).toBe(
      "https://media.example.net/stgy-images/0001000000000021/thumbs/797491/abcdef0123456789_image.webp",
    );
  });

  test("rewrites configured S3 profile masters to icon thumbnails", () => {
    const pageUrl = new URL("https://example.com/article");
    expect(
      normalizeLinkSnippetImageUrl(
        "https://assets.example.net/stgy-profiles/0001000000000021/masters/avatar.png",
        pageUrl,
        {
          frontendOrigins: ["https://service.example.net"],
          storagePublicUrlPrefix: "https://assets.example.net/{bucket}/",
          imagesBucket: "stgy-images",
          profilesBucket: "stgy-profiles",
        },
      ),
    ).toBe(
      "https://assets.example.net/stgy-profiles/0001000000000021/thumbs/avatar_icon.webp",
    );
  });

  test("keeps non-master objects on the configured S3 service unchanged", () => {
    const pageUrl = new URL("https://example.com/article");
    expect(
      normalizeLinkSnippetImageUrl(
        "https://media.example.net/other-bucket/path/object.webp?version=1#part",
        pageUrl,
        {
          frontendOrigins: ["https://social.example.net"],
          storagePublicUrlPrefix: "https://media.example.net/{bucket}/",
          imagesBucket: "images",
          profilesBucket: "profiles",
        },
      ),
    ).toBe("https://media.example.net/other-bucket/path/object.webp?version=1");
  });

  test("rejects ordinary HTTP image URLs but permits the configured local S3 origin", () => {
    const pageUrl = new URL("https://example.com/article");
    expect(
      normalizeLinkSnippetImageUrl("http://example.com/image.jpg", pageUrl, imagePolicy),
    ).toBeNull();
    expect(
      normalizeLinkSnippetImageUrl(
        "http://s3.localhost:8080/stgy-images/example.webp",
        pageUrl,
        {
          frontendOrigins: ["http://localhost:8080"],
          storagePublicUrlPrefix: "http://s3.localhost:8080/{bucket}/",
          imagesBucket: "stgy-images",
          profilesBucket: "stgy-profiles",
        },
      ),
    ).toBe("http://s3.localhost:8080/stgy-images/example.webp");
  });

  test("builds the public thumbnail URL for the featured uploaded image", () => {
    const markdown = `![first](/images/0001000000000021/masters/797491/11111111aaaaaaaa.jpg)

![chosen](/images/0001000000000021/masters/797491/22222222bbbbbbbb.png){featured}
`;
    expect(
      makeMarkdownLinkSnippetImageUrls(
        markdown,
        "https://s3.stgy.jp/{bucket}/",
        "stgy-images",
      ),
    ).toEqual({
      imageUrl:
        "https://s3.stgy.jp/stgy-images/0001000000000021/thumbs/797491/22222222bbbbbbbb_image.webp",
    });
  });

  test("uses the first eligible uploaded image when no image is explicitly featured", () => {
    const markdown = `![first](/images/0001000000000021/masters/797491/11111111aaaaaaaa.webp)
`;
    expect(
      makeMarkdownLinkSnippetImageUrls(
        markdown,
        "http://s3.localhost:8080/{bucket}/",
        "stgy-images",
      ),
    ).toEqual({
      imageUrl:
        "http://s3.localhost:8080/stgy-images/0001000000000021/thumbs/797491/11111111aaaaaaaa_image.webp",
    });
  });

  test("does not expose non-uploaded featured media as an internal snippet image", () => {
    expect(
      makeMarkdownLinkSnippetImageUrls(
        "![static](/data/logo.png)",
        "https://s3.stgy.jp/{bucket}/",
        "stgy-images",
      ),
    ).toBeNull();
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
