export const TRACK_MAP_REDRAW_DELAY_MS = 500;

const TRANSIENT_FIGURE_ATTRIBUTES = new Set([
  "data-stgy-track-initialized",
  "data-stgy-track-redraw",
  "data-char-position",
  "data-line-position",
]);

export type TrackMapReusePlan = Array<number | null>;

export function planTrackMapReuse(previousKeys: string[], nextKeys: string[]): TrackMapReusePlan {
  const queues = new Map<string, number[]>();
  previousKeys.forEach((key, index) => {
    const queue = queues.get(key);
    if (queue) queue.push(index);
    else queues.set(key, [index]);
  });

  return nextKeys.map((key) => {
    const queue = queues.get(key);
    if (!queue || queue.length === 0) return null;
    return queue.shift() ?? null;
  });
}

function removeTransientAttributes(root: HTMLElement) {
  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  elements.forEach((element) => {
    TRANSIENT_FIGURE_ATTRIBUTES.forEach((name) => element.removeAttribute(name));
  });
}

function replaceCanvasWithPlaceholder(figure: HTMLElement) {
  const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
  if (!canvas) return;
  const placeholder = figure.ownerDocument.createElement("div");
  placeholder.className = "stgy-track-canvas";
  canvas.replaceWith(placeholder);
}

function mapContextKey(figure: HTMLElement): string {
  const grid = figure.parentElement?.classList.contains("stgy-track-grid")
    ? figure.parentElement
    : null;
  const gridSize = grid
    ? Array.from(grid.children).filter((child) => child.classList.contains("stgy-track-map")).length
    : 0;
  const vertical = figure.closest(".pub-theme-dir-vert") ? "1" : "0";
  return `grid-size:${gridSize};vertical:${vertical}`;
}

export function getTrackMapRenderKey(figure: HTMLElement): string {
  const clone = figure.cloneNode(true) as HTMLElement;
  removeTransientAttributes(clone);
  clone.querySelectorAll(".stgy-track-caption").forEach((node) => node.remove());
  clone.querySelectorAll(".stgy-track-actions").forEach((node) => node.remove());
  clone.querySelectorAll(".stgy-track-graph").forEach((node) => node.remove());
  replaceCanvasWithPlaceholder(clone);
  return `${mapContextKey(figure)}\n${clone.outerHTML}`;
}

function directChildByClass(parent: HTMLElement, className: string): HTMLElement | null {
  return (
    (Array.from(parent.children).find((child) => child.classList.contains(className)) as
      | HTMLElement
      | undefined) ?? null
  );
}

function moveGeneratedChildren(previous: HTMLElement, next: HTMLElement) {
  const graph = directChildByClass(previous, "stgy-track-graph");
  if (graph) {
    const caption = directChildByClass(next, "stgy-track-caption");
    if (caption) next.insertBefore(graph, caption);
    else next.appendChild(graph);
  }

  const actions = directChildByClass(previous, "stgy-track-actions");
  if (actions) {
    const caption = directChildByClass(next, "stgy-track-caption");
    if (caption) caption.insertAdjacentElement("afterend", actions);
    else next.appendChild(actions);
  }
}

function moveSiblingGraph(previous: HTMLElement, next: HTMLElement) {
  const sibling = previous.nextElementSibling;
  if (!(sibling instanceof HTMLElement) || !sibling.classList.contains("stgy-track-graph")) {
    return;
  }
  next.insertAdjacentElement("afterend", sibling);
}

export type TrackMapReconcileResult = {
  reused: number;
  redraws: number;
};

export function reconcileTrackMapPreviews(
  previousRoot: HTMLElement,
  nextRoot: HTMLElement,
): TrackMapReconcileResult {
  const previousAllMaps = Array.from(previousRoot.querySelectorAll<HTMLElement>(".stgy-track-map"));
  const previousMaps = previousAllMaps.filter((figure) => {
    return figure.dataset.stgyTrackInitialized === "true";
  });
  const nextMaps = Array.from(nextRoot.querySelectorAll<HTMLElement>(".stgy-track-map"));
  const previousKeys = previousMaps.map(getTrackMapRenderKey);
  const nextKeys = nextMaps.map(getTrackMapRenderKey);
  const plan = planTrackMapReuse(previousKeys, nextKeys);
  let reused = 0;
  let redraws = 0;

  nextMaps.forEach((nextFigure, nextIndex) => {
    const previousIndex = plan[nextIndex];
    if (previousIndex == null) {
      if (previousAllMaps[nextIndex]) {
        nextFigure.dataset.stgyTrackRedraw = "true";
        redraws += 1;
      }
      return;
    }

    const previousFigure = previousMaps[previousIndex];
    const previousCanvas = previousFigure.querySelector<HTMLElement>(".stgy-track-canvas");
    const nextCanvas = nextFigure.querySelector<HTMLElement>(".stgy-track-canvas");
    if (!previousCanvas || !nextCanvas) return;

    nextCanvas.replaceWith(previousCanvas);
    moveGeneratedChildren(previousFigure, nextFigure);
    moveSiblingGraph(previousFigure, nextFigure);
    nextFigure.dataset.stgyTrackInitialized = "true";
    delete nextFigure.dataset.stgyTrackRedraw;
    reused += 1;
  });

  return { reused, redraws };
}
