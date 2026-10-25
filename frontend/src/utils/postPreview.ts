import type { MdHtmlFragment, MdHtmlPosition } from "stgy-markdown";

export type PreviewBlockSignature = Pick<MdHtmlFragment, "structureKey" | "renderKey">;

export type PreviewBlockUpdatePlan = {
  fullRebuild: boolean;
  dirtyIndices: number[];
  positionOnlyIndices: number[];
};

export type PreviewAnchor = {
  char: number;
  el: HTMLElement;
  positionId: number;
};

export type PreviewPositionBinding = {
  elements: HTMLElement[];
  anchors: PreviewAnchor[];
};

export function planPreviewBlockUpdate(
  previous: PreviewBlockSignature[],
  next: PreviewBlockSignature[],
): PreviewBlockUpdatePlan {
  if (previous.length !== next.length) {
    return { fullRebuild: true, dirtyIndices: [], positionOnlyIndices: [] };
  }
  for (let i = 0; i < previous.length; i++) {
    if (previous[i]!.structureKey !== next[i]!.structureKey) {
      return { fullRebuild: true, dirtyIndices: [], positionOnlyIndices: [] };
    }
  }

  const dirtyIndices: number[] = [];
  const positionOnlyIndices: number[] = [];
  for (let i = 0; i < previous.length; i++) {
    if (previous[i]!.renderKey === next[i]!.renderKey) positionOnlyIndices.push(i);
    else dirtyIndices.push(i);
  }
  return { fullRebuild: false, dirtyIndices, positionOnlyIndices };
}

export function createPreviewNode(documentRef: Document, html: string): ChildNode | null {
  const template = documentRef.createElement("template");
  template.innerHTML = html;
  if (template.content.childNodes.length !== 1) return null;
  return template.content.firstChild;
}

function positionElements(node: ChildNode): HTMLElement[] {
  if (!(node instanceof HTMLElement)) return [];
  const elements: HTMLElement[] = [];
  if (node.hasAttribute("data-preview-pos-id")) elements.push(node);
  elements.push(...Array.from(node.querySelectorAll<HTMLElement>("[data-preview-pos-id]")));
  return elements;
}

function updatePositionAttributes(
  elements: HTMLElement[],
  positions: MdHtmlPosition[],
): PreviewAnchor[] | null {
  if (elements.length !== positions.length) return null;
  const byId = new Array<HTMLElement | undefined>(positions.length);
  for (const element of elements) {
    const raw = element.getAttribute("data-preview-pos-id");
    if (raw === null || !/^\d+$/u.test(raw)) return null;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 0 || id >= positions.length || byId[id]) return null;
    byId[id] = element;
  }

  const anchors: PreviewAnchor[] = [];
  for (const position of positions) {
    const element = byId[position.id];
    if (!element) return null;
    if (position.charPosition === undefined) {
      if (element.hasAttribute("data-char-position")) element.removeAttribute("data-char-position");
    } else {
      const value = String(position.charPosition);
      if (element.getAttribute("data-char-position") !== value) {
        element.setAttribute("data-char-position", value);
      }
    }
    if (position.linePosition === undefined) {
      if (element.hasAttribute("data-line-position")) element.removeAttribute("data-line-position");
    } else {
      const value = String(position.linePosition);
      if (element.getAttribute("data-line-position") !== value) {
        element.setAttribute("data-line-position", value);
      }
    }
    if (position.charPosition !== undefined) {
      anchors.push({ char: position.charPosition, el: element, positionId: position.id });
    }
  }
  let sorted = true;
  for (let i = 1; i < anchors.length; i++) {
    const previous = anchors[i - 1]!;
    const current = anchors[i]!;
    if (
      previous.char > current.char ||
      (previous.char === current.char && previous.positionId > current.positionId)
    ) {
      sorted = false;
      break;
    }
  }
  if (!sorted) {
    anchors.sort((a, b) => a.char - b.char || a.positionId - b.positionId);
  }
  return anchors;
}

export function bindPreviewPositions(
  node: ChildNode,
  positions: MdHtmlPosition[],
): PreviewPositionBinding | null {
  const elements = positionElements(node);
  const anchors = updatePositionAttributes(elements, positions);
  return anchors ? { elements, anchors } : null;
}

export function updateBoundPreviewPositions(
  binding: PreviewPositionBinding,
  positions: MdHtmlPosition[],
): PreviewAnchor[] | null {
  return updatePositionAttributes(binding.elements, positions);
}
