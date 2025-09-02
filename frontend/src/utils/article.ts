import { Config } from "@/config";
import {
  MdNode,
  parseMarkdown,
  MdMediaRewriteRule,
  MdMediaRewriteOptions,
  mdRewriteMediaUrls,
  mdGroupImageGrid,
  mdFilterForFeatured,
  mdCutOff,
  mdRenderHtml,
  mdRenderText,
  deserializeMdNodes,
} from "fakebook-markdown";

export function makeArticleHtmlFromMarkdown(mdText: string) {
  let nodes = parseMarkdown(mdText);
  nodes = rewriteMediaUrls(nodes, false);
  nodes = mdGroupImageGrid(nodes, {maxElements: 4});
  return mdRenderHtml(nodes);
}

export function makeSnippetHtmlFromMarkdown(mdText: string) {
  const maxLen = Config.SNIPPET_MAX_LENGTH;
  const maxHeight = Config.SNIPPET_MAX_HEIGHT;
  const imgLen = Config.SNIPPET_MAX_LENGTH / 4;
  const imgHeight = Config.SNIPPET_MAX_HEIGHT / 4;
  let nodes = parseMarkdown(mdText);
  nodes = rewriteMediaUrls(nodes, true);
  nodes = mdFilterForFeatured(nodes);
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

export function makeTextFromJsonSnippet(snippet: string) {
  const nodes = deserializeMdNodes(snippet);
  return mdRenderText(nodes).slice(0, 50);
}

export function makeHtmlFromJsonSnippet(snippet: string) {
  let nodes = deserializeMdNodes(snippet);
  nodes = rewriteMediaUrls(nodes, true);
  return mdRenderHtml(nodes);
}

function rewriteMediaUrls(nodes: MdNode[], useThumbnail: boolean): MdNode[] {
  const imagesPrefix = Config.STORAGE_S3_PUBLIC_URL_PREFIX.replace(
    /\{bucket\}/g,
    Config.MEDIA_BUCKET_IMAGES,
  );
  const rewriteRules: MdMediaRewriteRule[] = [];
  if (useThumbnail) {
    rewriteRules.push({
      pattern: /^\/images\/(.*?)\/masters\/((?:[^\/?#]+\/)*)([^\/?#]+?)(?:\.[^\/?#]+)?(?:[?#].*)?$/,
      replacement: "/images/$1/thumbs/$2$3_image.webp",
    });
  }
  rewriteRules.push({
    pattern: /^\/images\//,
    replacement: imagesPrefix,
  });
  const opts: MdMediaRewriteOptions = {
    allowedPatterns: [/^\/(data|images|videos)\//],
    alternativeImage: "/data/no-image.svg",
    rewriteRules,
    maxObjects: Config.MAX_MEDIA_OBJECTS_PER_POST,
  };
  return mdRewriteMediaUrls(nodes, opts);
}
