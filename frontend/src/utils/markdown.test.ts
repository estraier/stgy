import {
  renderHtml
} from "./markdown";

describe("renderHtml basics", () => {
  it("empty body", () => {
    const mdText = "";
    expect(renderHtml(mdText)).toBe('');
  });

  it("single paragraph", () => {
    const mdText = "hello world";
    expect(renderHtml(mdText)).toBe('<p>hello world</p>');
  });

  it("single header 1", () => {
    const mdText = "# hello world";
    expect(renderHtml(mdText)).toBe('<h1>hello world</h1>');
  });

  it("single header 2", () => {
    const mdText = "## hello world";
    expect(renderHtml(mdText)).toBe('<h2>hello world</h2>');
  });

  it("single header 3", () => {
    const mdText = "### hello world";
    expect(renderHtml(mdText)).toBe('<h3>hello world</h3>');
  });

  it("escape characters", () => {
    const mdText = "<h1>John's House</h1>";
    expect(renderHtml(mdText)).toBe('<p>&lt;h1&gt;John&#39;s House&lt;/h1&gt;</p>');
  });

  it("single list", () => {
    const mdText = "- hello world";
    expect(renderHtml(mdText)).toBe('<ul><li>hello world</li></ul>');
  });

  it("single table", () => {
    const mdText = "|hello world|";
    expect(renderHtml(mdText)).toBe('<table><tr><td>hello world</td></tr></table>');
  });

  it("single image", () => {
    const mdText = "![tako](tako.jpg)";
    expect(renderHtml(mdText)).toBe('<div class=\"image-block\"><img src=\"tako.jpg\" alt=\"tako\"/></div>');
  });

  it("single quote", () => {
    const mdText = "> hello world";
    expect(renderHtml(mdText)).toBe('<blockquote>hello world</blockquote>');
  });
});
