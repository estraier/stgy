import { planTrackMapReuse } from "./liveTrackPreview";

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
