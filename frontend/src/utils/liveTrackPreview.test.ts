/** @jest-environment jsdom */

import {
  getTrackMapRenderKey,
  planTrackMapReuse,
  reconcileTrackMapPreviews,
} from "./liveTrackPreview";

describe("planTrackMapReuse", () => {
  test("reuses maps whose render keys are unchanged", () => {
    expect(planTrackMapReuse(["a", "b"], ["a", "b"])).toEqual([0, 1]);
  });

  test("does not reuse a map whose parameters changed", () => {
    expect(planTrackMapReuse(["a"], ["changed"])).toEqual([null]);
  });

  test("matches repeated maps in occurrence order", () => {
    expect(planTrackMapReuse(["same", "same", "other"], ["same", "other", "same"])).toEqual([
      0, 2, 1,
    ]);
  });

  test("reuses a stable map after another map is inserted", () => {
    expect(planTrackMapReuse(["old"], ["new", "old"])).toEqual([null, 0]);
  });
});

describe("track preview reuse", () => {
  test("ignores preview position metadata in the render key", () => {
    document.body.innerHTML =
      '<figure class="stgy-track-map" data-char-position="10" data-line-position="1" data-preview-pos-id="0"><div class="stgy-track-canvas"></div></figure>' +
      '<figure class="stgy-track-map" data-char-position="20" data-line-position="2" data-preview-pos-id="9"><div class="stgy-track-canvas"></div></figure>';
    const [a, b] = Array.from(document.body.children) as HTMLElement[];
    expect(getTrackMapRenderKey(a)).toBe(getTrackMapRenderKey(b));
  });

  test("reconciles when the root itself is a track map", () => {
    document.body.innerHTML =
      '<figure class="stgy-track-map" data-stgy-track-initialized="true"><div class="stgy-track-canvas"><canvas></canvas></div></figure>' +
      '<figure class="stgy-track-map"><div class="stgy-track-canvas"></div></figure>';
    const [oldRoot, nextRoot] = Array.from(
      document.body.children,
    ) as HTMLElement[];
    const oldCanvas = oldRoot.querySelector(".stgy-track-canvas")!;

    expect(reconcileTrackMapPreviews(oldRoot, nextRoot).reused).toBe(1);
    expect(nextRoot.querySelector(".stgy-track-canvas")).toBe(oldCanvas);
    expect(nextRoot.dataset.stgyTrackInitialized).toBe("true");
  });
});
