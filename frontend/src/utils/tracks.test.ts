import {
  getTrackFileKind,
  getTrackObjectKind,
  getTrackUploadDialogGridClass,
  getTrackUploadContentType,
  getTrackUploadFilename,
  makeTrackMarkdown,
  restPathFromTrackKey,
} from "./tracks";

describe("track helpers", () => {
  test("detects supported track formats case-insensitively", () => {
    expect(getTrackFileKind("ride.FIT")).toBe("FIT");
    expect(getTrackFileKind("ride.GPX")).toBe("GPX");
    expect(getTrackFileKind("ride.TrJ")).toBe("TRJ");
    expect(getTrackFileKind("ride.TrJgZ")).toBe("TRJGZ");
    expect(getTrackFileKind("ride.json")).toBeNull();
  });

  test("converts GPX and TRJ upload names to TRJGZ", () => {
    expect(getTrackUploadFilename("ride.gpx")).toBe("ride.trjgz");
    expect(getTrackUploadFilename("ride.TRJ")).toBe("ride.trjgz");
    expect(getTrackUploadFilename("ride.fit")).toBe("ride.fit");
    expect(getTrackUploadFilename("ride.trjgz")).toBe("ride.trjgz");
  });

  test("selects the upload content type from the resulting format", () => {
    expect(getTrackUploadContentType("ride.fit")).toBe("application/octet-stream");
    expect(getTrackUploadContentType("ride.gpx")).toBe("application/gzip");
    expect(getTrackUploadContentType("ride.trj")).toBe("application/gzip");
    expect(getTrackUploadContentType("ride.trjgz")).toBe("application/gzip");
  });

  test("uses the same responsive upload grid widths as the image dialog", () => {
    expect(getTrackUploadDialogGridClass(1)).toBe("grid-cols-1");
    expect(getTrackUploadDialogGridClass(2)).toBe("grid-cols-1 sm:grid-cols-2");
    expect(getTrackUploadDialogGridClass(3)).toBe("grid-cols-1 sm:grid-cols-2 md:grid-cols-3");
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
