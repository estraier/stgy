import { getPublishedMasterImage } from "./pubImage";

describe("getPublishedMasterImage", () => {
  const md = [
    "![a](/images/u1/masters/797491/a.jpg)",
    "![data](/data/x.png)",
    "![b](/images/u2/masters/797491/b.png?x=1)",
    "![movie](/videos/u1/masters/movie.mp4)",
  ].join("\n");

  test("uses the rendered media order, not only the master-image order", () => {
    expect(getPublishedMasterImage(md, 0)).toEqual({
      userId: "u1",
      key: "masters/797491/a.jpg",
    });
    expect(getPublishedMasterImage(md, 1)).toBeNull();
    expect(getPublishedMasterImage(md, 2)).toEqual({
      userId: "u2",
      key: "masters/797491/b.png",
    });
    expect(getPublishedMasterImage(md, 3)).toBeNull();
  });

  test("rejects traversal-like paths and invalid indexes", () => {
    expect(getPublishedMasterImage("![x](/images/u1/masters/../secret.jpg)", 0)).toBeNull();
    expect(getPublishedMasterImage(md, -1)).toBeNull();
  });
});
