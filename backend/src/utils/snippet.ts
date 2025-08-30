import { Config } from "../config";
import { parseMarkdown, mdFilterForFeatured, mdCutOff, serializeMdNodes } from "fakebook-markdown";

export function makeSnippetJsonFromMarkdown(mdText: string) {
  const maxLen = Config.SNIPPET_MAX_LENGTH;
  const maxHeight = Config.SNIPPET_MAX_HEIGHT;
  const imgLen = Config.SNIPPET_MAX_LENGTH / 4;
  const imgHeight = Config.SNIPPET_MAX_HEIGHT / 4;
  let nodes = parseMarkdown(mdText);
  nodes = mdFilterForFeatured(nodes);
  nodes = mdCutOff(nodes, { maxLen, maxHeight, imgLen, imgHeight });
  return serializeMdNodes(nodes);
}
