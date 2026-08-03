import {
  collectOwnedImageFilenames,
  collectUnexportedImageReferences,
  rewriteOwnedImageObjectUrlsToRelative,
} from "./exportImages";

describe("rewriteOwnedImageObjectUrlsToRelative", () => {
  const ownImage = "/images/u1/masters/797392/01234567deadbeef.jpg";
  const restoredFilename = "202607fedcba98deadbeef.jpg";

  test("rewrites an owned article image", () => {
    expect(
      rewriteOwnedImageObjectUrlsToRelative(`![photo](${ownImage})`, "u1", "../images"),
    ).toBe(`![photo](../images/${restoredFilename})`);
  });

  test("rewrites an owned map pin image", () => {
    const source = `@[map](map://138.4E,36.4N,13|138.4E,36.4N;Point;Description;;${ownImage})`;
    expect(rewriteOwnedImageObjectUrlsToRelative(source, "u1", "../images")).toBe(
      `@[map](map://138.4E,36.4N,13|138.4E,36.4N;Point;Description;;../images/${restoredFilename})`,
    );
  });

  test("preserves following pins after a rewritten image URL", () => {
    const source =
      `@[map](map://138.4,36.4,13|138.4,36.4;First;;;${ownImage}?v=1|` +
      "138.5,36.5;Second)";
    expect(rewriteOwnedImageObjectUrlsToRelative(source, "u1", "../images")).toBe(
      `@[map](map://138.4,36.4,13|138.4,36.4;First;;;../images/${restoredFilename}|` +
        "138.5,36.5;Second)",
    );
  });

  test("does not rewrite an image owned by another user", () => {
    const source = ownImage.replace("/u1/", "/u2/");
    expect(rewriteOwnedImageObjectUrlsToRelative(source, "u1", "../images")).toBe(source);
  });

  test("compares the complete owner id", () => {
    const source = ownImage.replace("/u1/", "/u10/");
    expect(rewriteOwnedImageObjectUrlsToRelative(source, "u1", "../images")).toBe(source);
  });

  test("removes query and fragment suffixes from rewritten owned URLs", () => {
    expect(
      rewriteOwnedImageObjectUrlsToRelative(`${ownImage}?v=1#preview`, "u1", "./images"),
    ).toBe(`./images/${restoredFilename}`);
  });
});


describe("collectOwnedImageFilenames", () => {
  test("collects unique owned images from articles and map pins", () => {
    const first = "/images/u1/masters/797392/01234567deadbeef.jpg";
    const second = "/images/u1/thumbs/797391/11234567cafebabe.webp?v=2";

    expect(
      Array.from(
        collectOwnedImageFilenames(
          [
            `![photo](${first})`,
            `@[map](map://138.4,36.4,13|138.4,36.4;Point;;;${first} ${second})`,
            first.replace("/u1/", "/u2/"),
          ],
          "u1",
        ),
      ),
    ).toEqual(["202607fedcba98deadbeef.jpg", "202608eedcba98cafebabe.webp"]);
  });
});

describe("collectUnexportedImageReferences", () => {
  test("reports images owned by another user and ignores exported own images", () => {
    const currentUserId = "19FC7A0B3C600000";
    const ownFirst =
      "/images/19FC7A0B3C600000/masters/797391/92a2cb6d5533deca.webp";
    const ownSecond =
      "/images/19FC7A0B3C600000/masters/797391/92a0f7d1c7eaa583.webp";
    const foreignFirst =
      "/images/0001000000000001/masters/797391/92a20216e12bb7c6.webp";
    const foreignSecond =
      "/images/0001000000000001/masters/797391/92a16911b9b111a7.webp";
    const exportedFilenames = collectOwnedImageFilenames(
      [ownFirst, ownSecond],
      currentUserId,
    );

    expect(
      collectUnexportedImageReferences(
        [
          {
            label: "Post p1 content",
            text: [
              `![](${ownFirst}){grid}`,
              `![](${ownSecond}){grid}`,
              `![](${foreignFirst}){grid}`,
              `![](${foreignSecond}){grid}`,
            ].join("\n"),
          },
        ],
        exportedFilenames,
        currentUserId,
      ),
    ).toEqual([
      {
        reference: foreignFirst,
        sources: ["Post p1 content"],
        reason: "owned-by-another-user",
      },
      {
        reference: foreignSecond,
        sources: ["Post p1 content"],
        reason: "owned-by-another-user",
      },
    ]);
  });

  test("reports an owned image that is missing from exported storage", () => {
    const reference = "/images/u1/masters/797392/01234567deadbeef.jpg?v=1";

    expect(
      collectUnexportedImageReferences(
        [{ label: "Profile introduction", text: `![](${reference})` }],
        new Set(),
        "u1",
      ),
    ).toEqual([
      {
        reference: "/images/u1/masters/797392/01234567deadbeef.jpg",
        sources: ["Profile introduction"],
        reason: "not-in-image-storage",
      },
    ]);
  });

  test("combines duplicate image references from content and snippet", () => {
    const reference = "/images/u2/masters/797392/01234567deadbeef.jpg";

    expect(
      collectUnexportedImageReferences(
        [
          { label: "Post p1 content", text: `![](${reference})` },
          { label: "Post p1 snippet", text: reference },
        ],
        new Set(),
        "u1",
      ),
    ).toEqual([
      {
        reference,
        sources: ["Post p1 content", "Post p1 snippet"],
        reason: "owned-by-another-user",
      },
    ]);
  });
});

