import { renderHtml } from "./markdown";

describe("renderHtml basics", () => {
  it("empty body", () => {
    const mdText = "";
    expect(renderHtml(mdText)).toBe("");
  });

  it("paragraph", () => {
    const mdText = "hello world";
    expect(renderHtml(mdText)).toBe("<p>hello world</p>");
  });

  it("header 1", () => {
    const mdText = "# hello world";
    expect(renderHtml(mdText)).toBe("<h1>hello world</h1>");
  });

  it("header 2", () => {
    const mdText = "## hello world";
    expect(renderHtml(mdText)).toBe("<h2>hello world</h2>");
  });

  it("header 3", () => {
    const mdText = "### hello world";
    expect(renderHtml(mdText)).toBe("<h3>hello world</h3>");
  });

  it("escape characters", () => {
    const mdText = "<h1>John's & House</h1>";
    expect(renderHtml(mdText)).toBe("<p>&lt;h1&gt;John&#39;s &amp; House&lt;/h1&gt;</p>");
  });

  it("list", () => {
    const mdText = "- hello world";
    expect(renderHtml(mdText)).toBe("<ul><li>hello world</li></ul>");
  });

  it("table", () => {
    const mdText = "|hello world|";
    expect(renderHtml(mdText)).toBe("<table><tr><td>hello world</td></tr></table>");
  });

  it("image", () => {
    const mdText = "![tako](tako.jpg)";
    expect(renderHtml(mdText)).toBe(
      '<figure class="image-block"><img src="tako.jpg" alt=""><figcaption>tako</figcaption></figure>',
    );
  });

  it("video", () => {
    const mdText = "![tako](tako.mp4){autoplay,seek=12s}";
    expect(renderHtml(mdText)).toBe(
      '<figure class="image-block"><video src="tako.mp4" aria-label="" controls></video><figcaption>tako</figcaption></figure>',
    );
  });

  it("quote", () => {
    const mdText = "> hello world";
    expect(renderHtml(mdText)).toBe("<blockquote>hello world</blockquote>");
  });

  it("decorations", () => {
    const mdText = "**strong** *em* __underline__ ~~strike~~ `code`";
    expect(renderHtml(mdText)).toBe(
      "<p><strong>strong</strong> <em>em</em> <u>underline</u> <s>strike</s> <code>code</code></p>",
    );
  });

  it("links", () => {
    const mdText = "[tako](tako.html) http://example.com/ika?uni=ebi#time";
    expect(renderHtml(mdText)).toBe(
      '<p>[tako](tako.html) <a href=\"http://example.com/ika?uni=ebi#time\">http://example.com/ika?uni=ebi#time</a></p>',
    );
  });

  it("escape", () => {
    const mdText = "\\*a\\* \\*\\*b\\*\\* \\__c_\\_ \\~~d~\\~ \\`e\\` \\\\123 \\A\\0";
    expect(renderHtml(mdText)).toBe("<p>*a* **b** __c__ ~~d~~ `e` \\123 \\A\\0</p>");
  });
});

describe("renderHtml advanced", () => {
  it("various formats", () => {
    const mdText = `# H1
abc
def

xyz
\`\`\`xml
<a>tako</a>
ika
\`\`\`
## H2
- a
b
- c
  - d
    - e
  - f
- g
- h
  - j
    - k
abc
|*a*|b|
|c|**d**|
![abc](def/ghi){thumbnail}
### H3
`;
    const expected = `<h1>H1</h1><p>abc<br>def</p><p>xyz</p><pre data-pre-mode="xml">&lt;a&gt;tako&lt;/a&gt;
ika</pre><h2>H2</h2><ul><li>a</li></ul><p>b</p><ul><li>c<ul><li>d<ul><li>e</li></ul></li><li>f</li></ul></li><li>g</li><li>h<ul><li>j<ul><li>k</li></ul></li></ul></li></ul><p>abc</p><table><tr><td><em>a</em></td><td>b</td></tr><tr><td>c</td><td><strong>d</strong></td></tr></table><figure class="image-block"><img src="def/ghi" alt=""><figcaption>abc</figcaption></figure><h3>H3</h3>`;
    expect(renderHtml(mdText)).toBe(expected);
  });

  it("thumbnail", () => {
    const mdText = `abc
![first](first.jpg)
def
![second](first.jpg){thumbnail}
ghi`;
    const expected =
      '<figure class="thumbnail-block"><img src="first.jpg" alt=""><figcaption>second</figcaption></figure><p>abc</p><p>def</p><p>ghi</p>';
    expect(renderHtml(mdText, { pickupThumbnail: true })).toBe(expected);
  });
});
