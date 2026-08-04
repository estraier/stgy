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
  anchor.classList.toggle(
    "stgy-link-snippet-link-with-image",
    snippet.imageUrl !== null,
  );
  if (snippet.imageUrl) {
    const image = document.createElement("img");
    image.className = "stgy-link-snippet-image";
    image.src = snippet.imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener(
      "error",
      () => {
        image.remove();
        anchor.classList.remove("stgy-link-snippet-link-with-image");
      },
      { once: true },
    );
    anchor.appendChild(image);
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
