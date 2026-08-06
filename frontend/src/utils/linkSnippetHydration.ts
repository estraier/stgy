import { resolveLinkSnippet } from "@/api/linkSnippets";
import type { LinkSnippet } from "@/api/models";

export type LinkSnippetResolver = (url: string) => Promise<LinkSnippet>;
export type LinkSnippetHydrator = (root: HTMLElement) => void;

function findLinkSnippetElements(root: HTMLElement): HTMLElement[] {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>(".stgy-link-snippet"),
  );
  if (root.matches(".stgy-link-snippet")) elements.unshift(root);
  return elements;
}

function findDirectLink(element: HTMLElement): HTMLAnchorElement | null {
  for (const child of Array.from(element.children)) {
    if (
      child instanceof HTMLAnchorElement &&
      child.classList.contains("stgy-link-snippet-link")
    ) {
      return child;
    }
  }
  return null;
}

function appendTextElement(
  parent: HTMLElement,
  className: string,
  text: string,
): void {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
}

function renderReadySnippet(element: HTMLElement, snippet: LinkSnippet): void {
  const anchor = findDirectLink(element);
  if (!anchor || !snippet.title) return;

  const explicitCaption = element.hasAttribute("data-caption")
    ? element.getAttribute("data-caption") || ""
    : null;
  const title = explicitCaption ?? snippet.title;

  anchor.replaceChildren();
  anchor.classList.remove("stgy-link-snippet-link-with-image");
  if (snippet.imageUrl) {
    const image = document.createElement("img");
    image.className =
      "stgy-link-snippet-image stgy-link-snippet-image-pending";
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";

    image.addEventListener(
      "load",
      () => {
        image.classList.remove("stgy-link-snippet-image-pending");
        anchor.classList.add("stgy-link-snippet-link-with-image");
      },
      { once: true },
    );
    image.addEventListener("error", () => {
      image.remove();
      anchor.classList.remove("stgy-link-snippet-link-with-image");
    });

    anchor.appendChild(image);
    image.src = snippet.imageUrl;
  }

  const body = document.createElement("span");
  body.className = "stgy-link-snippet-body";
  anchor.appendChild(body);
  if (snippet.siteName) {
    appendTextElement(
      body,
      "stgy-link-snippet-site-name",
      snippet.siteName,
    );
  }
  appendTextElement(body, "stgy-link-snippet-title", title);
  if (snippet.description) {
    appendTextElement(
      body,
      "stgy-link-snippet-description",
      snippet.description,
    );
  }
}

export type LinkSnippetReusePlan = Array<number | null>;

function linkSnippetSourceKey(element: HTMLElement): string | null {
  const anchor = findDirectLink(element);
  if (!anchor) return null;
  const href = anchor.getAttribute("href")?.trim() || anchor.href;
  if (!href) return null;
  const caption = element.hasAttribute("data-caption")
    ? element.getAttribute("data-caption") || ""
    : null;
  return JSON.stringify([href, caption]);
}

export function planLinkSnippetReuse(
  previousKeys: Array<string | null>,
  nextKeys: Array<string | null>,
): LinkSnippetReusePlan {
  const queues = new Map<string, number[]>();
  previousKeys.forEach((key, index) => {
    if (key === null) return;
    const queue = queues.get(key);
    if (queue) queue.push(index);
    else queues.set(key, [index]);
  });

  return nextKeys.map((key) => {
    if (key === null) return null;
    const queue = queues.get(key);
    if (!queue || queue.length === 0) return null;
    return queue.shift() ?? null;
  });
}

export function reconcileLinkSnippetPreviews(
  previousRoot: HTMLElement,
  nextRoot: HTMLElement,
): number {
  const previous = findLinkSnippetElements(previousRoot).filter(
    (element) => element.dataset.hydrated === "true",
  );
  const next = findLinkSnippetElements(nextRoot);
  const plan = planLinkSnippetReuse(
    previous.map(linkSnippetSourceKey),
    next.map(linkSnippetSourceKey),
  );
  let reused = 0;

  next.forEach((nextElement, nextIndex) => {
    const previousIndex = plan[nextIndex];
    if (previousIndex == null) return;
    const previousElement = previous[previousIndex];
    const previousAnchor = findDirectLink(previousElement);
    const nextAnchor = findDirectLink(nextElement);
    if (!previousAnchor || !nextAnchor) return;

    nextAnchor.replaceWith(previousAnchor);
    nextElement.dataset.hydrated = "true";
    delete nextElement.dataset.hydrating;
    if (previousElement.dataset.status) {
      nextElement.dataset.status = previousElement.dataset.status;
    } else {
      delete nextElement.dataset.status;
    }
    reused += 1;
  });

  return reused;
}

export function createLinkSnippetHydrator(
  resolver: LinkSnippetResolver = resolveLinkSnippet,
): LinkSnippetHydrator {
  const resolutions = new Map<string, Promise<LinkSnippet>>();

  const resolveOnce = (url: string): Promise<LinkSnippet> => {
    const existing = resolutions.get(url);
    if (existing) return existing;
    const pending = resolver(url).then(
      (snippet) => {
        if (snippet.status === "pending" || snippet.status === "fetch_failed") {
          resolutions.delete(url);
        }
        return snippet;
      },
      (error: unknown) => {
        resolutions.delete(url);
        throw error;
      },
    );
    resolutions.set(url, pending);
    return pending;
  };

  return (root: HTMLElement): void => {
    for (const element of findLinkSnippetElements(root)) {
      if (element.dataset.hydrated || element.dataset.hydrating) continue;
      const anchor = findDirectLink(element);
      if (!anchor) continue;

      const href = anchor.getAttribute("href");
      const url = href?.trim() || anchor.href;
      if (!url) continue;
      element.dataset.hydrating = "true";

      void resolveOnce(url)
        .then((snippet) => {
          delete element.dataset.hydrating;
          element.dataset.hydrated = "true";
          element.dataset.status = snippet.status;
          if (snippet.status === "ready") {
            renderReadySnippet(element, snippet);
          }
        })
        .catch(() => {
          delete element.dataset.hydrating;
          element.dataset.hydrated = "true";
          element.dataset.status = "fetch_failed";
        });
    }
  };
}
