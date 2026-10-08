import { parseMarkdown } from "stgy-markdown";
import type { MdNode } from "stgy-markdown";

export type PublishedMasterImageRef = {
  userId: string;
  key: string;
};

function parseMasterImageSource(src: string): PublishedMasterImageRef | null {
  const clean = src.split(/[?#]/, 1)[0] ?? "";
  const match = /^\/images\/([^/?#]+)\/masters\/(.+)$/.exec(clean);
  if (!match) return null;
  const userId = match[1] ?? "";
  const rest = match[2] ?? "";
  const parts = rest.split("/");
  if (
    !userId ||
    parts.length === 0 ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return { userId, key: `masters/${rest}` };
}

export function getPublishedMasterImage(
  markdown: string,
  mediaIndex: number,
): PublishedMasterImageRef | null {
  if (!Number.isInteger(mediaIndex) || mediaIndex < 0) return null;
  let currentIndex = 0;
  let resolved = false;
  let found: PublishedMasterImageRef | null = null;
  const visit = (nodes: MdNode[]) => {
    for (const node of nodes) {
      if (resolved) return;
      if (node.type !== "element") continue;
      if (node.tag === "img" || node.tag === "video") {
        if (currentIndex === mediaIndex) {
          resolved = true;
          if (node.tag === "img") {
            const src = node.attrs?.src;
            if (typeof src === "string") found = parseMasterImageSource(src);
          }
          return;
        }
        currentIndex += 1;
      }
      if (node.children) visit(node.children);
      if (resolved) return;
    }
  };
  visit(parseMarkdown(markdown));
  return found;
}
