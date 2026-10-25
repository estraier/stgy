/** @jest-environment jsdom */

import type { MdHtmlPosition } from "stgy-markdown";
import {
  bindPreviewPositions,
  createPreviewNode,
  planPreviewBlockUpdate,
  updateBoundPreviewPositions,
} from "./postPreview";

describe("planPreviewBlockUpdate", () => {
  test("marks only changed render content dirty", () => {
    const plan = planPreviewBlockUpdate(
      [
        { structureKey: "p", renderKey: "a" },
        { structureKey: "p", renderKey: "b" },
        { structureKey: "h2", renderKey: "c" },
      ],
      [
        { structureKey: "p", renderKey: "a" },
        { structureKey: "p", renderKey: "changed" },
        { structureKey: "h2", renderKey: "c" },
      ],
    );
    expect(plan).toEqual({
      fullRebuild: false,
      dirtyIndices: [1],
      positionOnlyIndices: [0, 2],
    });
  });

  test("falls back to a full rebuild when a block is inserted or removed", () => {
    const one = [{ structureKey: "p", renderKey: "a" }];
    const two = [
      { structureKey: "p", renderKey: "a" },
      { structureKey: "p", renderKey: "b" },
    ];
    expect(planPreviewBlockUpdate(one, two).fullRebuild).toBe(true);
    expect(planPreviewBlockUpdate(two, one).fullRebuild).toBe(true);
  });

  test("falls back when the top-level structure changes", () => {
    expect(
      planPreviewBlockUpdate(
        [{ structureKey: "h2", renderKey: "a" }],
        [{ structureKey: "h3", renderKey: "b" }],
      ).fullRebuild,
    ).toBe(true);
    expect(
      planPreviewBlockUpdate(
        [{ structureKey: "p", renderKey: "a" }],
        [{ structureKey: "ul", renderKey: "b" }],
      ).fullRebuild,
    ).toBe(true);
    expect(
      planPreviewBlockUpdate(
        [{ structureKey: "div:image-grid:2", renderKey: "a" }],
        [{ structureKey: "div:image-grid:3", renderKey: "b" }],
      ).fullRebuild,
    ).toBe(true);
  });
});

describe("preview position bindings", () => {
  test("updates absolute positions without replacing DOM nodes", () => {
    const node = createPreviewNode(
      document,
      '<p data-preview-pos-id="0" data-char-position="10"><a data-preview-pos-id="1" data-char-position="12">x</a></p>',
    );
    expect(node).not.toBeNull();
    const positions: MdHtmlPosition[] = [
      { id: 0, charPosition: 10, linePosition: 1 },
      { id: 1, charPosition: 12, linePosition: 1 },
    ];
    const binding = bindPreviewPositions(node!, positions);
    expect(binding).not.toBeNull();
    const paragraph = node as HTMLElement;
    const link = paragraph.querySelector("a")!;

    const next: MdHtmlPosition[] = [
      { id: 0, charPosition: 15, linePosition: 2 },
      { id: 1, charPosition: 17, linePosition: 2 },
    ];
    const anchors = updateBoundPreviewPositions(binding!, next);
    expect(anchors).not.toBeNull();
    expect(node).toBe(paragraph);
    expect(paragraph.getAttribute("data-char-position")).toBe("15");
    expect(link.getAttribute("data-char-position")).toBe("17");
    expect(anchors!.map((anchor) => anchor.char)).toEqual([15, 17]);
  });

  test("rejects an inconsistent position mapping", () => {
    const node = createPreviewNode(
      document,
      '<p data-preview-pos-id="0" data-char-position="10">x</p>',
    )!;
    expect(
      bindPreviewPositions(node, [
        { id: 0, charPosition: 10 },
        { id: 1, charPosition: 11 },
      ]),
    ).toBeNull();
  });
});
