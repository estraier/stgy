import { Config } from "@/config";
import {
  parseMarkdownBlocks,
  rewriteMediaUrls,
  groupImageGrid,
  filterNodesForThumbnail,
  cutOffMarkdownNodes,
  renderHtml,
  renderText
} from "@/utils/markdown";

export function dummy() {
  console.log(Config);
}

export function makeArticleHtmlFromMarkdown(mdText: string) {
  let nodes = parseMarkdownBlocks(mdText);
  nodes = rewriteMediaUrls(nodes, true);
  nodes = groupImageGrid(nodes);
  return renderHtml(nodes);
}

export function makeSnippetHtmlFromMarkdown(mdText: string) {
  const maxLen = 200;
  const maxHeight = 10;
  const imgLen = 50;
  const imgHeight = 6;
  let nodes = parseMarkdownBlocks(mdText);
  nodes = rewriteMediaUrls(nodes, true);
  nodes = groupImageGrid(nodes);
  nodes = filterNodesForThumbnail(nodes);
  nodes = cutOffMarkdownNodes(nodes, { maxLen, maxHeight, imgLen, imgHeight });
  return renderHtml(nodes);
}

export function makeSnippetTextFromMarkdown(mdText: string) {
  const maxLen = 50;
  const nodes = parseMarkdownBlocks(mdText);
  const text = renderText(nodes);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxLen ? flat.slice(0, maxLen) + "…" : flat;
}
