import {
  parsePostSearchQuery,
  serializePostSearchQuery,
  parseUserSearchQuery,
  serializeUserSearchQuery,
  parseBodyAndTags,
} from "./parse";

describe("parsePostSearchQuery", () => {
  test("empty -> {}", () => {
    expect(parsePostSearchQuery("")).toEqual({});
  });

  test("query only", () => {
    expect(parsePostSearchQuery("hello world")).toEqual({ query: "hello world" });
  });

  test("tag only", () => {
    expect(parsePostSearchQuery("#news")).toEqual({ tag: "news" });
  });

  test("ownedBy only", () => {
    expect(parsePostSearchQuery("@alice")).toEqual({ ownedBy: "alice" });
  });

  test("query + tag + ownedBy", () => {
    expect(parsePostSearchQuery("hello #news @alice")).toEqual({
      query: "hello",
      tag: "news",
      ownedBy: "alice",
    });
  });

  test("quoted phrase in query", () => {
    expect(parsePostSearchQuery('"hello   world" #fun')).toEqual({
      query: "hello world",
      tag: "fun",
    });
  });

  test("escaped # and @ are treated as plain words (keep symbol, drop backslash)", () => {
    expect(parsePostSearchQuery("\\#hash \\@user test")).toEqual({
      query: "#hash @user test",
    });
  });

  test("roundtrip with #/@ inside query", () => {
    const s = serializePostSearchQuery({ query: "#hash @user alpha", tag: "t", ownedBy: "o" });
    expect(parsePostSearchQuery(s)).toEqual({
      query: "#hash @user alpha",
      tag: "t",
      ownedBy: "o",
    });
  });
});

describe("serializePostSearchQuery", () => {
  test("basic serialize", () => {
    expect(serializePostSearchQuery({ query: "hello world", tag: "fun", ownedBy: "bob" })).toBe(
      "hello world #fun @bob",
    );
  });

  test("escapes quotes and wraps tokens with spaces", () => {
    expect(
      serializePostSearchQuery({ query: 'hello "world"', tag: "big fun", ownedBy: "b o b" }),
    ).toBe('hello \\"world\\" #"big fun" @"b o b"');
  });

  test("escapes leading # and @ in query tokens", () => {
    expect(serializePostSearchQuery({ query: "#hash @user", tag: "t", ownedBy: "o" })).toBe(
      "\\#hash \\@user #t @o",
    );
  });

  test("roundtrip (simple)", () => {
    const params = { query: "alpha beta", tag: "fun", ownedBy: "alice" };
    expect(parsePostSearchQuery(serializePostSearchQuery(params))).toEqual(params);
  });
});

describe("parseUserSearchQuery", () => {
  test("query only", () => {
    expect(parseUserSearchQuery("hello world")).toEqual({ query: "hello world" });
  });

  test("nickname only", () => {
    expect(parseUserSearchQuery("@bob")).toEqual({ nickname: "bob" });
  });

  test("query + nickname with quoted phrase", () => {
    expect(parseUserSearchQuery('"hello world" @bob')).toEqual({
      query: "hello world",
      nickname: "bob",
    });
  });

  test("escaped @ is treated as plain word (keep symbol, drop backslash)", () => {
    expect(parseUserSearchQuery("\\@bob hello")).toEqual({ query: "@bob hello" });
  });

  test("roundtrip with @ inside query", () => {
    const s = serializeUserSearchQuery({ query: "@alice hello", nickname: "bob" });
    expect(parseUserSearchQuery(s)).toEqual({ query: "@alice hello", nickname: "bob" });
  });
});

describe("serializeUserSearchQuery", () => {
  test("basic serialize", () => {
    expect(serializeUserSearchQuery({ query: "hello world", nickname: "bob" })).toBe(
      "hello world @bob",
    );
  });

  test("escapes quotes and wraps tokens with spaces", () => {
    expect(serializeUserSearchQuery({ query: 'hello "world"', nickname: "big bob" })).toBe(
      'hello \\"world\\" @"big bob"',
    );
  });

  test("roundtrip (simple)", () => {
    const params = { query: "alpha beta", nickname: "alice" };
    expect(parseUserSearchQuery(serializeUserSearchQuery(params))).toEqual(params);
  });
});

describe("parseBodyAndTags", () => {
  test("content only (no tags at end)", () => {
    const input = "line1\nline2";
    expect(parseBodyAndTags(input)).toEqual({
      content: "line1\nline2",
      tags: [],
      attrs: {},
    });
  });

  test("collects trailing tag lines and comma-separated tags (bottom-up order)", () => {
    const input = "hello\nworld\n#tag1, #tag2\n#tag2, #tag3";
    const result = parseBodyAndTags(input);
    expect(result.content).toBe("hello\nworld");
    expect(result.tags).toEqual(["tag2", "tag3", "tag1"]);
    expect(result.attrs).toEqual({});
  });

  test("handles flags [nolikes] and [noreplies] and uniqueness", () => {
    const input = "body\n#tag1, #[nolikes], #[noreplies]\n#tag1";
    const result = parseBodyAndTags(input);
    expect(result.content).toBe("body");
    expect(result.tags).toEqual(["tag1"]);
    expect(result.attrs).toEqual({ noLikes: true, noReplies: true });
  });

  test("inline # in the middle is not treated as trailing tag line", () => {
    const input = "line1\n#notatag\nend";
    const result = parseBodyAndTags(input);
    expect(result.content).toBe("line1\n#notatag\nend");
    expect(result.tags).toEqual([]);
    expect(result.attrs).toEqual({});
  });
});
