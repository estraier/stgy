import { Config } from "@/config";
import {
  parseMarkdown,
  mdRewriteMediaUrls,
  mdGroupImageGrid,
  mdFilterForThumbnail,
  mdCutOff,
  mdRenderHtml,
  mdRenderText,
} from "@/utils/markdown";

export function dummy() {
  console.log(Config);
}

export function makeArticleHtmlFromMarkdown(mdText: string) {
  let nodes = parseMarkdown(mdText);
  nodes = mdRewriteMediaUrls(nodes, true);
  nodes = mdGroupImageGrid(nodes);
  return mdRenderHtml(nodes);
}

export function makeSnippetHtmlFromMarkdown(mdText: string) {
  const maxLen = 200;
  const maxHeight = 10;
  const imgLen = 50;
  const imgHeight = 6;
  let nodes = parseMarkdown(mdText);
  nodes = mdRewriteMediaUrls(nodes, true);
  nodes = mdGroupImageGrid(nodes);
  nodes = mdFilterForThumbnail(nodes);
  nodes = mdCutOff(nodes, { maxLen, maxHeight, imgLen, imgHeight });
  return mdRenderHtml(nodes);
}

export function makeSnippetTextFromMarkdown(mdText: string) {
  const maxLen = 50;
  const nodes = parseMarkdown(mdText);
  const text = mdRenderText(nodes);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxLen ? flat.slice(0, maxLen) + "…" : flat;
}
