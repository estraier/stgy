jest.mock("@/config", () => ({
  Config: {
    STORAGE_S3_PUBLIC_URL_PREFIX: "https://cdn.test/{bucket}/",
    MEDIA_BUCKET_IMAGES: "images-bkt",
    MEDIA_BUCKET_TRACKS: "tracks-bkt",
    MAX_MEDIA_OBJECTS_PER_POST: 100,
    SNIPPET_MAX_LENGTH: 100,
    SNIPPET_MAX_HEIGHT: 60,
  },
}));

import {
  makeArticleHtmlFromMarkdown,
  makeArticleTextFromMarkdown,
  makeReplyDigestTextFromMarkdown,
  makePubArticleHtmlFromMarkdown,
  makeSnippetHtmlFromMarkdown,
  makeSnippetTextFromMarkdown,
  makeTextFromJsonSnippet,
  makeHtmlFromJsonSnippet,
  makePubAttributesFromJsonSnippet,
} from "./article";
import { serializeMdNodes } from "stgy-markdown";

describe("article utils (normal cases)", () => {
  test("makeArticleHtmlFromMarkdown", () => {
    const md = ["Hello world", "![cap](/images/u1/masters/abc/cat.jpg){width=400}"].join("\n\n");
    const html = makeArticleHtmlFromMarkdown(md);
    expect(html).toContain("<figure");
    expect(html).toContain('class="image-block"');
    expect(html).toContain('src="https://cdn.test/images-bkt/u1/masters/abc/cat.jpg"');
    expect(html).not.toContain("data-char-position");
    expect(html).not.toContain("data-line-position");
  });

  test("makeArticleHtmlFromMarkdown with PosAttrs", () => {
    const md = ["Hello world", "![cap](/images/u1/masters/abc/cat.jpg){width=400}"].join("\n\n");
    const html = makeArticleHtmlFromMarkdown(md, true);
    expect(html).toContain("<figure");
    expect(html).toContain('class="image-block"');
    expect(html).toContain('src="https://cdn.test/images-bkt/u1/masters/abc/cat.jpg"');
    expect(html).toContain("data-char-position");
    expect(html).toContain("data-line-position");
  });

  test("makeArticleHtmlFromMarkdown renders YouTube embeds", () => {
    const html = makeArticleHtmlFromMarkdown("@[Video](https://youtu.be/dQw4w9WgXcQ?t=90)");
    expect(html).toContain('class="stgy-embed stgy-youtube-embed"');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90"');
    expect(html).toContain("<figcaption");
    expect(html).toContain("Video</figcaption>");
  });

  test("makeSnippetHtmlFromMarkdown removes YouTube embeds", () => {
    const html = makeSnippetHtmlFromMarkdown(
      "before\n\n@[Video](https://youtu.be/dQw4w9WgXcQ)\n\nafter",
    );
    expect(html).toContain("before");
    expect(html).toContain("after");
    expect(html).not.toContain("youtube");
    expect(html).not.toContain("iframe");
  });

  test("makeArticleHtmlFromMarkdown rewrites managed track previews", () => {
    const html = makeArticleHtmlFromMarkdown("@[](/tracks/u1/previews/abc/ride.trjgz)");
    expect(html).toContain('data-src="https://cdn.test/tracks-bkt/u1/previews/abc/ride.trjgz"');
  });

  test("makeArticleTextFromMarkdown", () => {
    const md = "# Hello World\n- I am Nancy.";
    const text = makeArticleTextFromMarkdown(md);
    expect(text).toBe("Hello World\n\n- I am Nancy.");
  });

  test("makeReplyDigestTextFromMarkdown", () => {
    const md = "# Hello\n\nfirst\tsecond\r\nthird\u00a0fourth\u3000{{五|ご}}";
    expect(makeReplyDigestTextFromMarkdown(md)).toBe(
      "Hello first second third fourth 五",
    );
    expect(makeReplyDigestTextFromMarkdown("a".repeat(199))).toBe("a".repeat(199));
    expect(makeReplyDigestTextFromMarkdown("a".repeat(200))).toBe(
      "a".repeat(200) + "…",
    );
    expect(makeReplyDigestTextFromMarkdown("😀".repeat(201))).toBe(
      "😀".repeat(200) + "…",
    );
  });

  test("makePubArticleHtmlFromMarkdown", () => {
    const md =
      "abc\n# **title**\n-@author Nancy\n![cap](/images/u1/masters/folder/pic.png)\n[U](/users/123), [P](/posts/456)\n\n「{{あ|a}}」";
    const { html, title, desc, featured, metadata } = makePubArticleHtmlFromMarkdown(md);
    expect(html).toContain("<figure");
    expect(html).toContain('class="image-block"');
    expect(html).toContain('src="https://cdn.test/images-bkt/u1/thumbs/folder/pic_image.webp"');
    expect(html).toContain('<a href="/sites/123">U</a>');
    expect(html).toContain('<a href="/pub/456">P</a>');
    expect(html).toContain('<p data-mode="quote">「<ruby><rb>あ</rb><rt>a</rt></ruby>」</p>');
    expect(title).toBe("title");
    expect(desc).toBe("abc cap U, P 「あ」");
    expect(featured).toBe("https://cdn.test/images-bkt/u1/thumbs/folder/pic_image.webp");
    expect(metadata["author"]).toBe("Nancy");
  });

  test("makeSnippetHtmlFromMarkdown", () => {
    const md = "![cap](/images/u1/masters/folder/pic.png){featured=true}";
    const html = makeSnippetHtmlFromMarkdown(md);
    expect(html).toContain('class="featured-block"');
    expect(html).toContain('src="https://cdn.test/images-bkt/u1/thumbs/folder/pic_image.webp"');
  });

  test("vertical public rendering converts displayed ASCII to fullwidth", () => {
    const md = [
      "# TITLE 2026",
      "本文 ABC 123! [Link A1](/posts/123) [/posts/A1](/posts/A1) ``CODE 9``",
      "-@author Author A1",
    ].join("\n\n");

    const normal = makePubArticleHtmlFromMarkdown(md);
    const horizontal = makePubArticleHtmlFromMarkdown(md, undefined, {
      writingMode: "horizontal",
    });
    const vertical = makePubArticleHtmlFromMarkdown(md, undefined, {
      writingMode: "vertical",
    });

    expect(horizontal).toStrictEqual(normal);
    expect(normal.html).toContain("TITLE 2026");
    expect(vertical.html).toContain("ＴＩＴＬＥ　２０２６");
    expect(vertical.html).toContain("本文　ＡＢＣ　１２３！");
    expect(vertical.html).toContain('href="/pub/123"');
    expect(vertical.html).toContain(">Ｌｉｎｋ　Ａ１</a>");
    expect(vertical.html).toContain('href="/pub/A1">/posts/A1</a>');
    expect(vertical.html).toContain("<code>CODE 9</code>");
    expect(vertical.title).toBe("TITLE 2026");
    expect(vertical.metadata.author).toBe("Author A1");
    expect(vertical.desc).toContain("本文 ABC 123");
  });

  test("vertical public profile snippet uses the same displayed-text conversion", () => {
    const html = makeSnippetHtmlFromMarkdown("Profile ABC 123", undefined, {
      writingMode: "vertical",
    });
    expect(html).toContain("Ｐｒｏｆｉｌｅ　ＡＢＣ　１２３");
  });

  test("vertical rich post snippet converts text and preserves attributes", () => {
    const snippet = serializeMdNodes([
      {
        type: "element",
        tag: "a",
        attrs: { href: "https://example.com/ABC123" },
        children: [{ type: "text", text: "Display ABC 123" }],
      },
    ]);
    const html = makeHtmlFromJsonSnippet(snippet, undefined, {
      writingMode: "vertical",
    });
    expect(html).toBe(
      '<a href="https://example.com/ABC123">Ｄｉｓｐｌａｙ　ＡＢＣ　１２３</a>',
    );
  });

  test("vertical plain post snippet uses the same conversion", () => {
    const snippet = serializeMdNodes([
      {
        type: "element",
        tag: "h1",
        children: [{ type: "text", text: "Title A1" }],
      },
      {
        type: "element",
        tag: "li",
        attrs: { meta: "author" },
        children: [{ type: "text", text: "Author B2" }],
      },
      {
        type: "element",
        tag: "p",
        children: [{ type: "text", text: "Body C3" }],
      },
    ]);
    const attrs = makePubAttributesFromJsonSnippet(snippet, {
      writingMode: "vertical",
    });
    expect(attrs).toStrictEqual({
      title: "Ｔｉｔｌｅ　Ａ１",
      desc: "Ｂｏｄｙ　Ｃ３",
      metadata: { author: "Ａｕｔｈｏｒ　Ｂ２" },
    });
  });

  test("makeSnippetTextFromMarkdown", () => {
    const md =
      "**Bold** text with some  \nnewlines and   extra   spaces. " +
      "Then a long tail 1234567890 1234567890 1234567890.";
    const text = makeSnippetTextFromMarkdown(md);
    expect(text.length).toBeLessThanOrEqual(101);
    expect(text.endsWith("…")).toBe(true);
  });

  test("makeTextFromJsonSnippet", () => {
    const nodes = [
      {
        type: "element" as const,
        tag: "p",
        children: [{ type: "text" as const, text: "Hello from JSON snippet content!" }],
      },
    ];
    const snippet = serializeMdNodes(nodes);
    const text = makeTextFromJsonSnippet(snippet);
    expect(text).toBe("Hello from JSON snippet content!");
  });

  test("makeHtmlFromJsonSnippet", () => {
    const nodes = [
      {
        type: "element" as const,
        tag: "figure",
        attrs: { class: "image-block" },
        children: [
          {
            type: "element" as const,
            tag: "img",
            attrs: { src: "/images/u2/masters/pic.jpg" },
            children: [],
          },
        ],
      },
    ];
    const snippet = serializeMdNodes(nodes);
    const html = makeHtmlFromJsonSnippet(snippet);
    expect(html).toContain('src="https://cdn.test/images-bkt/u2/thumbs/pic_image.webp"');
  });

  test("makeHtmlFromJsonSnippet can move a leading featured image after h1", () => {
    const nodes = [
      {
        type: "element" as const,
        tag: "figure",
        attrs: { class: "featured-block", "data-grid": "" },
        children: [
          {
            type: "element" as const,
            tag: "img",
            attrs: { src: "/images/u2/masters/pic.jpg" },
            children: [],
          },
        ],
      },
      {
        type: "element" as const,
        tag: "h1",
        children: [{ type: "text" as const, text: "Heading" }],
      },
      {
        type: "element" as const,
        tag: "p",
        children: [{ type: "text" as const, text: "Body" }],
      },
    ];
    const snippet = serializeMdNodes(nodes);

    const normalHtml = makeHtmlFromJsonSnippet(snippet, "normal-h");
    expect(normalHtml.indexOf("<figure")).toBeLessThan(normalHtml.indexOf("<h1"));

    const sidebarHtml = makeHtmlFromJsonSnippet(snippet, "sidebar-h", {
      moveLeadingFeaturedAfterHeading: true,
    });
    expect(sidebarHtml.indexOf("<h1")).toBeLessThan(sidebarHtml.indexOf("<figure"));
    expect(sidebarHtml.indexOf("<figure")).toBeLessThan(sidebarHtml.indexOf("<p>"));
  });

  test("makeHtmlFromJsonSnippet does not move other leading figures", () => {
    const nodes = [
      {
        type: "element" as const,
        tag: "figure",
        attrs: { class: "image-block" },
        children: [],
      },
      {
        type: "element" as const,
        tag: "h1",
        children: [{ type: "text" as const, text: "Heading" }],
      },
    ];
    const snippet = serializeMdNodes(nodes);
    const html = makeHtmlFromJsonSnippet(snippet, "sidebar-h", {
      moveLeadingFeaturedAfterHeading: true,
    });
    expect(html.indexOf("<figure")).toBeLessThan(html.indexOf("<h1"));
  });

  test("makePubAttributesFromJsonSnippet", () => {
    const nodes = [
      {
        type: "element" as const,
        tag: "h1",
        children: [
          {
            type: "text" as const,
            text: "hello",
          },
        ],
      },
      {
        type: "element",
        tag: "li",
        attrs: {
          meta: "author",
        },
        children: [
          {
            type: "text",
            text: "john",
          },
        ],
      },
      {
        type: "element" as const,
        tag: "p",
        children: [
          {
            type: "text" as const,
            text: "world",
          },
        ],
      },
    ];
    const snippet = serializeMdNodes(nodes);
    const attrs = makePubAttributesFromJsonSnippet(snippet);
    expect(attrs.title).toBe("hello");
    expect(attrs.desc).toBe("world");
    expect(attrs.metadata.author).toBe("john");
  });
});
