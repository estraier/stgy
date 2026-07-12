export type AnchorRect = {
  top: number;
  right: number;
  bottom: number;
};

export type PopoverPosition = {
  top: number;
  left: number;
  width: number;
};

type CalculatePopoverPositionOptions = {
  viewportWidth: number;
  viewportHeight: number;
  preferredWidth?: number;
  popoverHeight?: number;
  gap?: number;
  margin?: number;
};

export function calculatePopoverPosition(
  anchor: AnchorRect,
  options: CalculatePopoverPositionOptions,
): PopoverPosition {
  const margin = options.margin ?? 8;
  const gap = options.gap ?? 4;
  const preferredWidth = options.preferredWidth ?? 320;
  const popoverHeight = options.popoverHeight ?? 336;
  const availableWidth = Math.max(0, options.viewportWidth - margin * 2);
  const width = Math.min(preferredWidth, availableWidth);
  const maxLeft = Math.max(margin, options.viewportWidth - margin - width);
  const left = Math.min(Math.max(margin, anchor.right - width), maxLeft);
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - popoverHeight;
  const maxTop = Math.max(margin, options.viewportHeight - margin - popoverHeight);
  const top = below + popoverHeight <= options.viewportHeight - margin
    ? below
    : above >= margin
      ? above
      : Math.min(Math.max(margin, below), maxTop);

  return { top, left, width };
}
