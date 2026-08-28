import type { Post } from "@/api/models";
import {
  EXPORTER_VERSION,
  EXPORT_MANIFEST_FORMAT,
  EXPORT_MANIFEST_VERSION,
  makePostSourceFingerprint,
  parseExportManifest,
  sha256Hex,
  type ExportManifest,
} from "./exportManifest";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "0000000000000001",
    ownedBy: "0000000000000001",
    replyTo: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    publishedAt: null,
    updatedAt: null,
    snippet: "{}",
    locale: "en",
    allowLikes: true,
    allowReplies: true,
    ownerNickname: "user",
    ownerLocale: "en",
    replyToOwnerId: null,
    replyToOwnerNickname: null,
    countLikes: 0,
    countReplies: 0,
    tags: [],
    ...overrides,
  };
}

function makeManifest(): ExportManifest {
  return {
    format: EXPORT_MANIFEST_FORMAT,
    version: EXPORT_MANIFEST_VERSION,
    exporterVersion: EXPORTER_VERSION,
    userId: "0000000000000001",
    rootDir: "stgy-export-0000000000000001",
    exportedAt: "2026-08-12T00:00:00.000Z",
    files: {
      "posts/0000000000000001.json": {
        modifiedAt: "2026-08-12T00:00:00.000Z",
        size: 10,
        sha256: "0".repeat(64),
      },
    },
    posts: {},
    images: {},
    tracks: {},
  };
}

describe("parseExportManifest", () => {
  test("accepts a matching manifest", () => {
    const manifest = makeManifest();
    expect(
      parseExportManifest(
        JSON.stringify(manifest),
        manifest.userId,
        manifest.rootDir,
      ),
    ).toEqual(manifest);
  });

  test("rejects a manifest for another user", () => {
    const manifest = makeManifest();
    expect(() =>
      parseExportManifest(
        JSON.stringify(manifest),
        "0000000000000002",
        "stgy-export-0000000000000002",
      ),
    ).toThrow("different user");
  });

  test("rejects unsafe file paths", () => {
    const manifest = makeManifest();
    manifest.files["../outside"] = manifest.files["posts/0000000000000001.json"];
    expect(() =>
      parseExportManifest(JSON.stringify(manifest), manifest.userId, manifest.rootDir),
    ).toThrow("invalid file path");
  });
});

describe("manifest hashes", () => {
  test("computes SHA-256", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("post fingerprint is order-stable and changes when a reply changes", async () => {
    const post = makePost({ tags: ["b", "a"], countReplies: 2 });
    const reply1 = makePost({
      id: "0000000000000010",
      replyTo: post.id,
      ownedBy: "0000000000000010",
      ownerNickname: "r1",
    });
    const reply2 = makePost({
      id: "0000000000000020",
      replyTo: post.id,
      ownedBy: "0000000000000020",
      ownerNickname: "r2",
    });

    const first = await makePostSourceFingerprint(post, [reply1, reply2], []);
    const reordered = await makePostSourceFingerprint(
      { ...post, tags: ["a", "b"] },
      [reply2, reply1],
      [],
    );
    const changed = await makePostSourceFingerprint(
      post,
      [reply1, { ...reply2, updatedAt: "2026-08-12T01:00:00.000Z" }],
      [],
    );

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  test("post fingerprint is order-stable and changes when a comment changes", async () => {
    const post = makePost();
    const comment1 = {
      id: "0000000000000030",
      postId: post.id,
      nickname: "guest1",
      body: "one\n",
      status: "pending" as const,
      isAuthor: false,
      createdAt: "2026-08-28T00:00:00.000Z",
    };
    const comment2 = {
      id: "0000000000000040",
      postId: post.id,
      nickname: "guest2",
      body: "two\n",
      status: "published" as const,
      isAuthor: false,
      createdAt: "2026-08-28T00:01:00.000Z",
    };

    const first = await makePostSourceFingerprint(post, [], [comment1, comment2]);
    const reordered = await makePostSourceFingerprint(post, [], [comment2, comment1]);
    const changed = await makePostSourceFingerprint(post, [], [
      comment1,
      { ...comment2, body: "edited\n" },
    ]);

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });
});
