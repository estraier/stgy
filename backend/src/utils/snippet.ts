import { Config } from "../config";
import {
  parseMarkdown,
  mdFilterForFeatured,
  mdCutOff,
  serializeMdNodes,
  deserializeMdNodes,
  mdRenderText,
} from "stgy-markdown";
import type { MdNode } from "stgy-markdown";

export function makeSnippetJsonFromMarkdown(mdText: string) {
  const maxLen = Config.SNIPPET_MAX_LENGTH;
  const maxHeight = Config.SNIPPET_MAX_HEIGHT;
  const imgLen = Config.SNIPPET_MAX_LENGTH / 4;
  const imgHeight = Config.SNIPPET_MAX_HEIGHT / 4;
  let nodes = parseMarkdown(mdText);
  nodes = mdFilterForFeatured(nodes);
  nodes = mdCutOff(nodes, { maxLen, maxHeight, imgLen, imgHeight, cutOnHr: true });
  return serializeMdNodes(nodes);
}

export function makeTextFromJsonSnippet(snippet: string) {
  const nodes = deserializeMdNodes(snippet);
  return mdRenderText(nodes).slice(0, 50);
}

export function getMentionsFromMarkdown(mdText: string): string[] {
  const nodes = parseMarkdown(mdText);
  const result: string[] = [];
  const seen = new Set<string>();
  const collectText = (ns: MdNode[]): string => {
    let out = "";
    for (const n of ns) {
      if (n.type === "text") {
        out += n.text;
      } else if (n.type === "element") {
        out += collectText(n.children ?? []);
      }
    }
    return out;
  };
  const visit = (n: MdNode): void => {
    if (n.type === "element") {
      if (n.tag === "a") {
        const attrs = n.attrs;
        const hrefValue = attrs?.href;
        if (typeof hrefValue === "string" && hrefValue.startsWith("/users/")) {
          const anchorText = collectText(n.children ?? []).trim();
          if (anchorText.startsWith("@")) {
            const userId = hrefValue.slice("/users/".length);
            if (userId.length > 0 && /^[0-9A-Za-z]+$/.test(userId)) {
              if (!seen.has(userId)) {
                seen.add(userId);
                result.push(userId);
              }
            }
          }
        }
      }
      for (const child of n.children ?? []) {
        visit(child);
      }
    }
  };
  for (const n of nodes) {
    visit(n);
  }
  return result;
}
