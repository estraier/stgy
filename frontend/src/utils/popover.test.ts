import { calculatePopoverPosition } from "./popover";

describe("calculatePopoverPosition", () => {
  test("aligns the popover with the right edge of the anchor", () => {
    expect(
      calculatePopoverPosition(
        { top: 40, right: 900, bottom: 64 },
        { viewportWidth: 1000, viewportHeight: 800 },
      ),
    ).toEqual({ top: 68, left: 580, width: 320 });
  });

  test("keeps the popover inside a narrow viewport", () => {
    expect(
      calculatePopoverPosition(
        { top: 40, right: 250, bottom: 64 },
        { viewportWidth: 280, viewportHeight: 800 },
      ),
    ).toEqual({ top: 68, left: 8, width: 264 });
  });

  test("places the popover above the anchor when there is no room below", () => {
    expect(
      calculatePopoverPosition(
        { top: 500, right: 900, bottom: 524 },
        {
          viewportWidth: 1000,
          viewportHeight: 600,
          popoverHeight: 300,
        },
      ),
    ).toEqual({ top: 196, left: 580, width: 320 });
  });
});
