import { makeExistingMediaMarkdown } from "./mediaEmbed";

describe("makeExistingMediaMarkdown", () => {
  test("formats selected images as a grid", () => {
    expect(
      makeExistingMediaMarkdown({
        kind: "images",
        keys: ["u1/a.jpg", "u1/b.png"],
      }),
    ).toBe("![](/images/u1/a.jpg){grid}\n![](/images/u1/b.png){grid}\n");
  });

  test("formats selected tracks with blank lines", () => {
    expect(
      makeExistingMediaMarkdown({
        kind: "tracks",
        tracks: [
          { previewKey: "u1/previews/a.trjgz" },
          { previewKey: "u1/previews/b.trjgz" },
        ],
      }),
    ).toBe(
      "@[](/tracks/u1/previews/a.trjgz)\n\n" +
        "@[](/tracks/u1/previews/b.trjgz)\n",
    );
  });

  test("returns an empty string for an empty selection", () => {
    expect(makeExistingMediaMarkdown({ kind: "images", keys: [] })).toBe("");
    expect(makeExistingMediaMarkdown({ kind: "tracks", tracks: [] })).toBe("");
  });
});
