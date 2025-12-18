import {
  makeSnippetJsonFromMarkdown,
  makeTextFromJsonSnippet,
  makeTextFromMarkdown,
  getMentionsFromMarkdown,
} from "./snippet";

describe("makeSnippetJsonFromMarkdown", () => {
  it("simple", () => {
    const mdText = "hello world";
    const expected = '[{"T":"p","X":"hello world"}]';
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

describe("makeTextFromJsonSnippet", () => {
  it("simple", () => {
    const snippet = '[{"T":"p","X":"hello world"}]';
    const expected = "hello world";
    expect(makeTextFromJsonSnippet(snippet)).toStrictEqual(expected);
  });
});

describe("makeTextFromMarkdown", () => {
  it("simple", () => {
    const mdText = "# foo\n## bar\nbaz\n";
    const expected = "foo\n\nbar\n\nbaz";
    expect(makeTextFromMarkdown(mdText)).toStrictEqual(expected);
  });
});

describe("getMentionsFromMarkdown", () => {
  it("simple", () => {
    const md = `
hello [@alice](/users/ALICE1) and [@bob](/users/bob42)
and a normal link [site](/users/not-mention)
`;
    expect(getMentionsFromMarkdown(md)).toEqual(["ALICE1", "bob42"]);
  });
});
