import { makeSnippetJsonFromMarkdown } from "./snippet";

describe("makeSnippetJsonFromMarkdown", () => {
  it("simple", () => {
    const mdText = "hello world";
    const expected = '[{"T":"p","X":"hello world"}]';

    console.log(makeSnippetJsonFromMarkdown(mdText));

    expect(makeSnippetJsonFromMarkdown(mdText)).toStrictEqual(expected);
  });

  it("complex", () => {
    const mdText = `# H
P
![ALT](/URL)
- li1
- li2
`;
    const expected =
      '[{"T":"figure","C":[{"T":"img","SR":"/URL"},{"T":"figcaption","X":"ALT"}],"CL":"featured-block"},{"T":"h1","X":"H"},{"T":"p","X":"P"},{"T":"ul","C":[{"T":"li","X":"li1"},{"T":"li","X":"li2"}]}]';
    expect(makeSnippetJsonFromMarkdown(mdText)).toStrictEqual(expected);
  });
});
