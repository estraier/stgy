import {
  buildTrackMarkdownLine,
  cycleTrackBaseOptions,
  getNextTrackBaseValue,
  isTrackGraphDisabled,
  parseMarkdownOptions,
  parseTrackMarkdownLine,
  toggleTrackGraphOptions,
  updateTrackLayoutOptions,
  updateTrackMarkdownLine,
  updateTrackSizeOptions,
} from "./markdownTrackOptions";

describe("markdown track options", () => {
  test("parses a track embedding line", () => {
    expect(
      parseTrackMarkdownLine("  @[Ride](/tracks/u/previews/a.trjgz){grid,base=osm}  "),
    ).toEqual({
      leading: "  ",
      caption: "Ride",
      url: "/tracks/u/previews/a.trjgz",
      options: "grid,base=osm",
      trailing: "  ",
    });
  });

  test("rejects non-track markdown lines", () => {
    expect(parseTrackMarkdownLine("![Ride](/images/a.jpg)")).toBeNull();
    expect(parseTrackMarkdownLine("[Ride](/tracks/a.trjgz)")).toBeNull();
  });

  test("rebuilds a line while preserving surrounding whitespace", () => {
    const match = parseTrackMarkdownLine(" @[Ride](map://1,2) ");
    expect(match).not.toBeNull();
    expect(
      buildTrackMarkdownLine(match!, [
        { key: "float", value: "left" },
        { key: "graph", value: "false" },
      ]),
    ).toBe(" @[Ride](map://1,2){float=left,graph=false} ");
  });

  test("toggles layout options", () => {
    const base = parseMarkdownOptions("base=osm,graph=false");
    const grid = updateTrackLayoutOptions(base, "grid");
    expect(grid).toEqual([
      { key: "base", value: "osm" },
      { key: "graph", value: "false" },
      { key: "grid", value: null },
    ]);
    expect(updateTrackLayoutOptions(grid, "grid")).toEqual(base);
    expect(updateTrackLayoutOptions(grid, "float-right")).toEqual([
      { key: "base", value: "osm" },
      { key: "graph", value: "false" },
      { key: "float", value: "right" },
    ]);
  });

  test("toggles size options with medium as the default", () => {
    const base = parseMarkdownOptions("base=osm");
    const small = updateTrackSizeOptions(base, "s");
    expect(small).toEqual([
      { key: "base", value: "osm" },
      { key: "size", value: "small" },
    ]);
    expect(updateTrackSizeOptions(small, "s")).toEqual(base);
    expect(updateTrackSizeOptions(small, "m")).toEqual(base);
  });

  test("cycles base through every supported value", () => {
    let tokens = parseMarkdownOptions(null);
    const values: Array<string | null> = ["pale", "std", "photo", "cycle", "osm", "topo", null];
    for (const value of values) {
      tokens = cycleTrackBaseOptions(tokens);
      expect(tokens.find((token) => token.key === "base")?.value ?? null).toBe(value);
    }
  });

  test("resets an invalid base value to unspecified", () => {
    expect(getNextTrackBaseValue("invalid")).toBeNull();
    expect(cycleTrackBaseOptions(parseMarkdownOptions("base=invalid,grid"))).toEqual([
      { key: "grid", value: null },
    ]);
  });

  test("toggles graph between unspecified and false", () => {
    const disabled = toggleTrackGraphOptions(parseMarkdownOptions("base=pale"));
    expect(isTrackGraphDisabled(disabled)).toBe(true);
    expect(disabled).toEqual([
      { key: "base", value: "pale" },
      { key: "graph", value: "false" },
    ]);
    expect(toggleTrackGraphOptions(disabled)).toEqual([{ key: "base", value: "pale" }]);
  });

  test("normalizes graph=true to graph=false when toggled", () => {
    expect(toggleTrackGraphOptions(parseMarkdownOptions("graph=true,grid"))).toEqual([
      { key: "grid", value: null },
      { key: "graph", value: "false" },
    ]);
  });

  test("updates a complete track line", () => {
    expect(
      updateTrackMarkdownLine("@[Ride](/tracks/a.trjgz){base=std}", cycleTrackBaseOptions),
    ).toBe("@[Ride](/tracks/a.trjgz){base=photo}");
  });
});
