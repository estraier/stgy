import { rewriteOwnedImageObjectUrlsToRelative } from "./exportImages";

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
