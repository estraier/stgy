jest.mock("@/config", () => ({
  Config: {
    STORAGE_S3_PUBLIC_URL_PREFIX: "https://cdn.test/{bucket}/",
    MEDIA_BUCKET_IMAGES: "images-bkt",
    MAX_MEDIA_OBJECTS_PER_POST: 100,
    SNIPPET_MAX_LENGTH: 100,
    SNIPPET_MAX_HEIGHT: 60,
  },
}));

import {
  makeArticleHtmlFromMarkdown,
  makeArticleTextFromMarkdown,
  makePubArticleHtmlFromMarkdown,
  makeSnippetHtmlFromMarkdown,
  makeSnippetTextFromMarkdown,
  makeTextFromJsonSnippet,
  makeHtmlFromJsonSnippet,
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

  test("makeArticleTextFromMarkdown", () => {
    const md = "# Hello World\n- I am Nancy.";
    const text = makeArticleTextFromMarkdown(md);
    console.log(text);
    expect(text).toBe("Hello World\n\n- I am Nancy.");
  });

  test("makePubArticleHtmlFromMarkdown", () => {
    const md =
      "abc\n# **title**\n![cap](/images/u1/masters/folder/pic.png)\n[U](/users/123), [P](/posts/456)";
    const { html, title, desc, featured } = makePubArticleHtmlFromMarkdown(md);
    expect(html).toContain("<figure");
    expect(html).toContain('class="image-block"');
    expect(html).toContain('src="https://cdn.test/images-bkt/u1/thumbs/folder/pic_image.webp"');
    expect(html).toContain('<a href="/pub/sites/123">U</a>');
    expect(html).toContain('<a href="/pub/456">P</a>');
    expect(title).toBe("title");
    expect(desc).toBe("abc cap U, P");
    expect(featured).toBe("https://cdn.test/images-bkt/u1/thumbs/folder/pic_image.webp");
  });

  test("makeSnippetHtmlFromMarkdown", () => {
    const md = "![cap](/images/u1/masters/folder/pic.png){featured=true}";
    const html = makeSnippetHtmlFromMarkdown(md);
    expect(html).toContain('class="featured-block"');
    expect(html).toContain('src="https://cdn.test/images-bkt/u1/thumbs/folder/pic_image.webp"');
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
});
