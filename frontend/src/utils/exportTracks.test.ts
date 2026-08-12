import type { TrackObject } from "@/api/models";
import {
  collectOwnedTrackKeys,
  collectUnexportedTrackReferences,
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

describe("collectOwnedTrackKeys", () => {
  test("collects owned master and preview keys only", () => {
    expect(
      Array.from(
        collectOwnedTrackKeys(
          [
            "@[](/tracks/u1/previews/797392/01234567deadbeef.trjgz)",
            "/tracks/u1/masters/797391/11234567cafebabe.fit",
            "/tracks/u2/previews/797390/21234567feedface.trjgz",
          ],
          "u1",
        ),
      ),
    ).toEqual([
      "u1/previews/797392/01234567deadbeef.trjgz",
      "u1/masters/797391/11234567cafebabe.fit",
    ]);
  });
});

describe("collectUnexportedTrackReferences", () => {
  const entries = makeTrackArchiveEntries([makeTrack()], "u1");

  test("reports STGY track paths that are not exportable", () => {
    expect(
      collectUnexportedTrackReferences(
        [
          {
            label: "Post p1 content",
            text: [
              "@[](/tracks/u1/previews/797392/01234567deadbeef.trjgz)",
              "@[](/tracks/u2/previews/797391/11234567cafebabe.trjgz?x=1)",
            ].join("\n"),
          },
        ],
        entries,
        "u1",
      ),
    ).toEqual([
      {
        reference: "/tracks/u2/previews/797391/11234567cafebabe.trjgz",
        sources: ["Post p1 content"],
        reason: "owned-by-another-user",
      },
    ]);
  });

  test("reports a missing track owned by the current user", () => {
    expect(
      collectUnexportedTrackReferences(
        [
          {
            label: "Post p1 content",
            text: "@[](/tracks/u1/previews/797391/11234567cafebabe.trjgz)",
          },
        ],
        entries,
        "u1",
      ),
    ).toEqual([
      {
        reference: "/tracks/u1/previews/797391/11234567cafebabe.trjgz",
        sources: ["Post p1 content"],
        reason: "not-in-track-storage",
      },
    ]);
  });

  test("reports a track owned by another STGY user", () => {
    expect(
      collectUnexportedTrackReferences(
        [
          {
            label: "Post 19F3FC04CB800000 content",
            text: "@[](/tracks/0001000000000001/previews/797391/9e0a5a40d5c85370.trjgz){base=cycle,lthr=151,ftp=223}",
          },
        ],
        [],
        "0001000000000021",
      ),
    ).toEqual([
      {
        reference:
          "/tracks/0001000000000001/previews/797391/9e0a5a40d5c85370.trjgz",
        sources: ["Post 19F3FC04CB800000 content"],
        reason: "owned-by-another-user",
      },
    ]);
  });

  test("combines duplicate references and ignores unrelated external URLs", () => {
    expect(
      collectUnexportedTrackReferences(
        [
          {
            label: "Post p1 content",
            text: "@[](/tracks/u2/previews/797391/11234567cafebabe.trjgz)",
          },
          {
            label: "Post p1 snippet",
            text: [
              "/tracks/u2/previews/797391/11234567cafebabe.trjgz",
              "https://example.com/ride.trjgz",
            ].join("\n"),
          },
        ],
        entries,
        "u1",
      ),
    ).toEqual([
      {
        reference: "/tracks/u2/previews/797391/11234567cafebabe.trjgz",
        sources: ["Post p1 content", "Post p1 snippet"],
        reason: "owned-by-another-user",
      },
    ]);
  });
});

