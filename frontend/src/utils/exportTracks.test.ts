import type { TrackObject } from "@/api/models";
import {
  filterReferencedTrackArchiveEntries,
  makeTrackArchiveEntries,
  rewriteTrackObjectUrlsToRelative,
} from "./exportTracks";

function makeTrack(overrides: Partial<TrackObject> = {}): TrackObject {
  return {
    bucket: "tracks",
    key: "u1/masters/797392/01234567deadbeef.fit",
    size: 123,
    lastModified: "2026-07-01T00:00:00.000Z",
    contentType: "application/octet-stream",
    publicUrl: "https://cdn.test/tracks/u1/masters/797392/01234567deadbeef.fit",
    previewKey: "u1/previews/797392/01234567deadbeef.trjgz",
    previewUrl: "https://cdn.test/tracks/u1/previews/797392/01234567deadbeef.trjgz",
    ...overrides,
  };
}

describe("makeTrackArchiveEntries", () => {
  test("uses a shared archive stem for master and preview", () => {
    expect(makeTrackArchiveEntries([makeTrack()], "u1")).toEqual([
      {
        track: makeTrack(),
        masterFilename: "797392-01234567deadbeef.fit",
        previewFilename: "797392-01234567deadbeef.trjgz",
      },
    ]);
  });

  test("keeps TRJGZ masters as original files", () => {
    const track = makeTrack({
      key: "u1/masters/797392/01234567deadbeef.trjgz",
      contentType: "application/gzip",
    });
    expect(makeTrackArchiveEntries([track], "u1")[0].masterFilename).toBe(
      "797392-01234567deadbeef.trjgz",
    );
  });

  test("rejects keys owned by another user", () => {
    expect(() => makeTrackArchiveEntries([makeTrack()], "u2")).toThrow(
      "Invalid track master key",
    );
  });
});

describe("rewriteTrackObjectUrlsToRelative", () => {
  const entries = makeTrackArchiveEntries([makeTrack()], "u1");

  test("rewrites managed preview paths", () => {
    const source = "@[](/tracks/u1/previews/797392/01234567deadbeef.trjgz)";
    expect(rewriteTrackObjectUrlsToRelative(source, entries, "../tracks")).toBe(
      "@[](../tracks/previews/797392-01234567deadbeef.trjgz)",
    );
  });

  test("rewrites managed master and public URLs to the local preview", () => {
    const source = [
      "/tracks/u1/masters/797392/01234567deadbeef.fit",
      "https://cdn.test/tracks/u1/previews/797392/01234567deadbeef.trjgz?v=1",
    ].join("\n");
    expect(rewriteTrackObjectUrlsToRelative(source, entries, "./tracks")).toBe(
      [
        "./tracks/previews/797392-01234567deadbeef.trjgz",
        "./tracks/previews/797392-01234567deadbeef.trjgz",
      ].join("\n"),
    );
  });

  test("preserves pins after a rewritten track URL", () => {
    const source =
      "@[Ride](https://cdn.test/tracks/u1/masters/797392/01234567deadbeef.fit?v=1|" +
      "139.1,35.1;Stop)";
    expect(rewriteTrackObjectUrlsToRelative(source, entries, "../tracks")).toBe(
      "@[Ride](../tracks/previews/797392-01234567deadbeef.trjgz|139.1,35.1;Stop)",
    );
  });

  test("leaves external track URLs unchanged", () => {
    const source = "@[](https://example.com/ride.trjgz)";
    expect(rewriteTrackObjectUrlsToRelative(source, entries, "../tracks")).toBe(source);
  });
});


describe("filterReferencedTrackArchiveEntries", () => {
  const first = makeTrack();
  const second = makeTrack({
    key: "u1/masters/797391/11234567cafebabe.trjgz",
    publicUrl: "https://cdn.test/tracks/u1/masters/797391/11234567cafebabe.trjgz",
    previewKey: "u1/previews/797391/11234567cafebabe.trjgz",
    previewUrl: "https://cdn.test/tracks/u1/previews/797391/11234567cafebabe.trjgz",
  });
  const entries = makeTrackArchiveEntries([first, second], "u1");

  test("keeps only tracks referenced by managed master or preview URLs", () => {
    const referenced = filterReferencedTrackArchiveEntries(
      [
        "@[](/tracks/u1/previews/797392/01234567deadbeef.trjgz)",
        "https://cdn.test/tracks/u1/masters/797391/11234567cafebabe.trjgz?v=1",
      ],
      entries,
    );

    expect(referenced.map((entry) => entry.track.key)).toEqual([first.key, second.key]);
  });

  test("omits unreferenced tracks", () => {
    expect(filterReferencedTrackArchiveEntries(["No maps here"], entries)).toEqual([]);
  });
});
