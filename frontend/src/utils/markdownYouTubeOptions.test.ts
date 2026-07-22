import {
  buildYouTubeMarkdownLine,
  isYouTubeUrl,
  parseYouTubeMarkdownLine,
  parseYouTubeOptions,
  updateYouTubeMarkdownLine,
  updateYouTubeSizeOptions,
} from "./markdownYouTubeOptions";

describe("markdown YouTube options", () => {
  test.each([
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
  ])("recognizes YouTube URL %s", (url) => {
    expect(isYouTubeUrl(url)).toBe(true);
  });

  test("rejects non-YouTube and lookalike URLs", () => {
    expect(isYouTubeUrl("map://135.123,35.123")).toBe(false);
    expect(isYouTubeUrl("https://www.youtube.com.example.org/watch?v=dQw4w9WgXcQ")).toBe(
      false,
    );
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=short")).toBe(false);
  });

  test("parses a YouTube embedding line", () => {
    expect(
      parseYouTubeMarkdownLine(
        "  @[Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ){size=small,foo=bar}  ",
      ),
    ).toEqual({
      leading: "  ",
      caption: "Video",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      options: "size=small,foo=bar",
      trailing: "  ",
    });
  });

  test("rejects non-YouTube embedding lines", () => {
    expect(parseYouTubeMarkdownLine("![Video](/images/a.jpg)")).toBeNull();
    expect(parseYouTubeMarkdownLine("@[Ride](map://1,2)")).toBeNull();
  });

  test("rebuilds a line while preserving unknown options and whitespace", () => {
    const match = parseYouTubeMarkdownLine(
      " @[Video](https://youtu.be/dQw4w9WgXcQ){foo=bar,size=small,baz=qux} ",
    );
    expect(match).not.toBeNull();
    expect(
      buildYouTubeMarkdownLine(
        match!,
        updateYouTubeSizeOptions(parseYouTubeOptions(match!.options), "l"),
      ),
    ).toBe(
      " @[Video](https://youtu.be/dQw4w9WgXcQ){foo=bar,baz=qux,size=large} ",
    );
  });

  test("uses missing size as medium and toggles explicit sizes", () => {
    expect(updateYouTubeSizeOptions([{ key: "foo", value: "bar" }], "m")).toEqual([
      { key: "foo", value: "bar" },
    ]);
    expect(
      updateYouTubeSizeOptions(
        [
          { key: "foo", value: "bar" },
          { key: "size", value: "small" },
        ],
        "s",
      ),
    ).toEqual([{ key: "foo", value: "bar" }]);
  });

  test("updates only YouTube lines", () => {
    expect(
      updateYouTubeMarkdownLine(
        "@[Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ){foo=bar}",
        (tokens) => updateYouTubeSizeOptions(tokens, "xl"),
      ),
    ).toBe(
      "@[Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ){foo=bar,size=xlarge}",
    );
    expect(
      updateYouTubeMarkdownLine("@[Ride](map://1,2)", (tokens) => tokens),
    ).toBeNull();
  });
});
