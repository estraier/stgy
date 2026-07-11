import {
  getTrackFileKind,
  getTrackObjectKind,
  getTrackUploadDialogGridClass,
  getTrackUploadContentType,
  makeTrackMarkdown,
  restPathFromTrackKey,
} from "./tracks";

describe("track helpers", () => {
  test("detects supported track formats case-insensitively", () => {
    expect(getTrackFileKind("ride.FIT")).toBe("FIT");
    expect(getTrackFileKind("ride.TrJgZ")).toBe("TRJGZ");
    expect(getTrackFileKind("ride.gpx")).toBeNull();
  });

  test("selects the upload content type from the extension", () => {
    expect(getTrackUploadContentType("ride.fit")).toBe("application/octet-stream");
    expect(getTrackUploadContentType("ride.trjgz")).toBe("application/gzip");
  });

  test("uses the same responsive upload grid widths as the image dialog", () => {
    expect(getTrackUploadDialogGridClass(1)).toBe("grid-cols-1");
    expect(getTrackUploadDialogGridClass(2)).toBe("grid-cols-1 sm:grid-cols-2");
    expect(getTrackUploadDialogGridClass(3)).toBe(
      "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
    );
  });

  test("removes only the leading owner prefix", () => {
    expect(restPathFromTrackKey("u1/masters/a.fit", "u1")).toBe("masters/a.fit");
    expect(restPathFromTrackKey("other/masters/a.fit", "u1")).toBe("other/masters/a.fit");
  });

  test("detects the stored master format", () => {
    expect(getTrackObjectKind({ key: "u1/masters/a.fit" })).toBe("FIT");
    expect(getTrackObjectKind({ key: "u1/masters/a.trjgz" })).toBe("TRJGZ");
  });

  test("creates a map macro for the preview TrackJSON", () => {
    expect(
      makeTrackMarkdown({
        previewKey: "u1/previews/a.trjgz",
      }),
    ).toBe("@[](/tracks/u1/previews/a.trjgz)");
  });
});
