import { classifyEditorUploadFiles, getEditorUploadSelectionError } from "./uploadFiles";

function makeFile(name: string, type = ""): File {
  return new File(["test"], name, { type });
}

describe("classifyEditorUploadFiles", () => {
  test("classifies image, text, and all supported track inputs", () => {
    const files = [
      makeFile("photo.JPG", "image/jpeg"),
      makeFile("notes.md", "text/markdown"),
      makeFile("ride.FIT", "application/octet-stream"),
      makeFile("route.gpx", "application/gpx+xml"),
      makeFile("route.trj", "application/json"),
      makeFile("route.TRJGZ", "application/gzip"),
    ];

    const result = classifyEditorUploadFiles(files);

    expect(result.imageFiles.map((file) => file.name)).toEqual(["photo.JPG"]);
    expect(result.textFiles.map((file) => file.name)).toEqual(["notes.md"]);
    expect(result.trackFiles.map((file) => file.name)).toEqual([
      "ride.FIT",
      "route.gpx",
      "route.trj",
      "route.TRJGZ",
    ]);
    expect(result.unsupportedFiles).toEqual([]);
  });

  test("classifies GPX as a track even when its MIME type is text", () => {
    const result = classifyEditorUploadFiles([makeFile("route.gpx", "text/xml")]);

    expect(result.trackFiles).toHaveLength(1);
    expect(result.textFiles).toHaveLength(0);
  });

  test("keeps unsupported files separate", () => {
    const result = classifyEditorUploadFiles([makeFile("archive.zip", "application/zip")]);

    expect(result.unsupportedFiles.map((file) => file.name)).toEqual(["archive.zip"]);
  });
});

describe("getEditorUploadSelectionError", () => {
  test("rejects mixed image and track selections", () => {
    const classified = classifyEditorUploadFiles([
      makeFile("photo.jpg", "image/jpeg"),
      makeFile("ride.fit", "application/octet-stream"),
    ]);

    expect(getEditorUploadSelectionError(classified)).toBe(
      "Images and tracks cannot be uploaded simultaneously.",
    );
  });

  test("reports unsupported filenames", () => {
    const classified = classifyEditorUploadFiles([makeFile("archive.zip", "application/zip")]);

    expect(getEditorUploadSelectionError(classified)).toBe("Unsupported file type: archive.zip");
  });
});
