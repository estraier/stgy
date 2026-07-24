jest.mock("@/config", () => ({
  Config: {
    STORAGE_S3_PUBLIC_URL_PREFIX: "https://cdn.test/{bucket}/",
    MEDIA_BUCKET_IMAGES: "images-bkt",
  },
}));

import { rewriteTrackImageUrl } from "./trackImageUrl";

describe("rewriteTrackImageUrl", () => {
  test("rewrites an STGY master image path to its preview image", () => {
    expect(rewriteTrackImageUrl("/images/u1/masters/photo.jpg")).toBe(
      "https://cdn.test/images-bkt/u1/thumbs/photo_image.webp",
    );
    expect(
      rewriteTrackImageUrl(
        "/images/u1/masters/202607/01234567deadbeef.jpeg",
      ),
    ).toBe(
      "https://cdn.test/images-bkt/u1/thumbs/202607/01234567deadbeef_image.webp",
    );
  });

  test("leaves an explicitly specified preview image key unchanged", () => {
    expect(rewriteTrackImageUrl("/images/u1/thumbs/photo_image.webp")).toBe(
      "https://cdn.test/images-bkt/u1/thumbs/photo_image.webp",
    );
  });

  test("leaves other allowed paths unchanged", () => {
    expect(rewriteTrackImageUrl("/data/no-image.svg")).toBe("/data/no-image.svg");
    expect(rewriteTrackImageUrl("/media/u1/images/photo.jpg")).toBe(
      "/media/u1/images/photo.jpg",
    );
  });

  test("rejects an empty image object key", () => {
    expect(rewriteTrackImageUrl("/images/")).toBeNull();
  });
});
