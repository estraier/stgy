import {
  parsePostSearchQuery,
  serializePostSearchQuery,
  parseUserSearchQuery,
  serializeUserSearchQuery,
  parseBodyAndTags,
  parseDateString,
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

  test("quoted phrase in query (quotes preserved for non-tag/non-mention)", () => {
    expect(parsePostSearchQuery('"hello   world" #fun')).toEqual({
      query: '"hello world"',
      tag: "fun",
    });
  });

  test("quoted tag and mention (quotes removed)", () => {
    expect(parsePostSearchQuery('"#barack obama" "@barack obama"')).toEqual({
      tag: "barack obama",
      ownedBy: "barack obama",
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
    ).toBe('hello "world" "#big fun" "@b o b"');
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

  test("query + nickname with quoted phrase (quotes preserved)", () => {
    expect(parseUserSearchQuery('"hello world" @bob')).toEqual({
      query: '"hello world"',
      nickname: "bob",
    });
  });

  test("quoted nickname (quotes removed)", () => {
    expect(parseUserSearchQuery('"@barack obama"')).toEqual({
      nickname: "barack obama",
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
      'hello "world" "@big bob"',
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

describe("parseDateString", () => {
  test("canonical data", () => {
    expect(parseDateString("0").toISOString()).toBe("0000-01-01T00:00:00.000Z");
    expect(parseDateString("0012").toISOString()).toBe("0012-01-01T00:00:00.000Z");
    expect(parseDateString("0012-11").toISOString()).toBe("0012-11-01T00:00:00.000Z");
    expect(parseDateString("0012-11-22").toISOString()).toBe("0012-11-22T00:00:00.000Z");
    expect(parseDateString("0012-11-22T11").toISOString()).toBe("0012-11-22T11:00:00.000Z");
    expect(parseDateString("0012-11-22T11:22").toISOString()).toBe("0012-11-22T11:22:00.000Z");
    expect(parseDateString("0012-11-22T11:22:33").toISOString()).toBe("0012-11-22T11:22:33.000Z");
    expect(parseDateString("0012-11-22T11:22:33.44").toISOString()).toBe(
      "0012-11-22T11:22:33.440Z",
    );
    expect(parseDateString("0012-11-22T11:22:33.44+09:00").toISOString()).toBe(
      "0012-11-22T02:22:33.440Z",
    );
  });

  test("human readable data", () => {
    expect(parseDateString("1978/02/11").toISOString()).toBe("1978-02-11T00:00:00.000Z");
    expect(parseDateString("1978/02-11 18:35:05+09").toISOString()).toBe(
      "1978-02-11T09:35:05.000Z",
    );
    expect(parseDateString("1978年").toISOString()).toBe("1978-01-01T00:00:00.000Z");
    expect(parseDateString("1978年02月").toISOString()).toBe("1978-02-01T00:00:00.000Z");
    expect(parseDateString("1978年02月11日").toISOString()).toBe("1978-02-11T00:00:00.000Z");
    expect(parseDateString("1978年02月11日18時").toISOString()).toBe("1978-02-11T18:00:00.000Z");
    expect(parseDateString("1978年02月11日18時35分").toISOString()).toBe(
      "1978-02-11T18:35:00.000Z",
    );
    expect(parseDateString("1978年02月11日18時35分05秒").toISOString()).toBe(
      "1978-02-11T18:35:05.000Z",
    );
    expect(parseDateString("1978年02月11日18時35分05秒+09").toISOString()).toBe(
      "1978-02-11T09:35:05.000Z",
    );
  });

  test("invalid data", () => {
    expect(parseDateString("")).toBe(null);
    expect(parseDateString("abc")).toBe(null);
  });
});
