import { parsePostSearchQuery } from "./postSearchQuery";

describe("parsePostSearchQuery", () => {
  test("separates owner and published status filters from body terms", () => {
    expect(
      parsePostSearchQuery("owner:0000000000020101 status:published foo bar"),
    ).toEqual({
      query: "foo bar",
      owners: ["0000000000020101"],
      publishedOnly: true,
    });
  });

  test("does not interpret quoted prefixes as filters", () => {
    expect(parsePostSearchQuery('"owner:12345" "status:published" foo')).toEqual({
      query: '"owner:12345" "status:published" foo',
      owners: [],
      publishedOnly: false,
    });
  });

  test("rejects malformed special filters", () => {
    expect(() => parsePostSearchQuery("owner:")).toThrow("owner filter requires a user ID");
    expect(() => parsePostSearchQuery("status:draft")).toThrow("invalid status filter");
  });
});
