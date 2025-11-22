import { Config } from "../config";
import {
  parseMarkdown,
  mdFilterForFeatured,
  mdCutOff,
  serializeMdNodes,
  deserializeMdNodes,
  mdRenderText,
} from "stgy-markdown";

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
