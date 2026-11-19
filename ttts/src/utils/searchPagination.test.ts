import {
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_OFFSET,
  parseSearchPagination,
  SearchPaginationError,
} from "./searchPagination";

describe("search pagination parameters", () => {
  test("uses defaults only when parameters are omitted", () => {
    expect(parseSearchPagination(undefined, undefined)).toEqual({ limit: 100, offset: 0 });
    expect(parseSearchPagination("7", undefined)).toEqual({ limit: 7, offset: 0 });
    expect(parseSearchPagination(undefined, "5")).toEqual({ limit: 100, offset: 5 });
  });

  test("accepts both boundaries and ordinary pagination", () => {
    expect(parseSearchPagination("1", "0")).toEqual({ limit: 1, offset: 0 });
    expect(parseSearchPagination("50", "250")).toEqual({ limit: 50, offset: 250 });
    expect(parseSearchPagination(String(MAX_SEARCH_LIMIT), String(MAX_SEARCH_OFFSET))).toEqual({
      limit: MAX_SEARCH_LIMIT,
      offset: MAX_SEARCH_OFFSET,
    });
  });

  test.each([
    ["0", "0"],
    ["-1", "0"],
    ["2001", "0"],
    ["NaN", "0"],
    ["Infinity", "0"],
    ["1e9", "0"],
    ["3.5", "0"],
    ["2abc", "0"],
    [" 20", "0"],
    ["", "0"],
    ["9007199254740993", "0"],
    [["10", "20"], "0"],
    [{ nested: "10" }, "0"],
    [null, "0"],
    ["1", "-1"],
    ["1", "10001"],
    ["1", "1.5"],
    ["1", "1e9"],
    ["1", "5oops"],
    ["1", ["0", "1"]],
    ["1", null],
  ])("rejects malformed or out-of-bounds pagination: limit=%j offset=%j", (limit, offset) => {
    expect(() => parseSearchPagination(limit, offset)).toThrow(SearchPaginationError);
  });
});
