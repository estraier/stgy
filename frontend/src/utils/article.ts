import { Config } from "@/config";
import {
  MdNode,
  parseMarkdown,
  MdMediaRewriteOptions,
  mdRewriteMediaUrls,
  mdGroupImageGrid,
  mdFilterForThumbnail,
  mdCutOff,
  mdRenderHtml,
  mdRenderText,
} from "@/utils/markdown";

export function makeArticleHtmlFromMarkdown(mdText: string) {
  let nodes = parseMarkdown(mdText);
  nodes = rewriteMediaUrls(nodes, false);
  nodes = mdGroupImageGrid(nodes);
  return mdRenderHtml(nodes);
}

export function makeSnippetHtmlFromMarkdown(mdText: string) {
  const maxLen = Config.SNIPPET_MAX_LENGTH;
  const maxHeight = Config.SNIPPET_MAX_HEIGHT;
  const imgLen = Config.SNIPPET_MAX_LENGTH / 4;
  const imgHeight = Config.SNIPPET_MAX_HEIGHT / 4;
  let nodes = parseMarkdown(mdText);
  nodes = rewriteMediaUrls(nodes, true);
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

function rewriteMediaUrls(nodes: MdNode[], useThumbnail: boolean): MdNode[] {
  const base = `${Config.STORAGE_S3_PUBLIC_BASE_URL}/${Config.MEDIA_BUCKET_IMAGES}`;
  const opts: MdMediaRewriteOptions = {
    allowedPatterns: [/^\/(data|images|videos)\//],
    alternativeImage: "/data/no-image.svg",
    rewriteRules: useThumbnail
      ? [
          {
            pattern:
              /^\/images\/(.*?)\/masters\/((?:[^\/?#]+\/)*)([^\/?#]+?)(?:\.[^\/?#]+)?(?:[?#].*)?$/,
            replacement: `${base}/$1/thumbs/$2$3_image.webp`,
          },
          {
            pattern: /^\/images\//,
            replacement: `${base}/`,
          },
        ]
      : [
          {
            pattern: /^\/images\//,
            replacement: `${base}/`,
          },
        ],
  };
  return mdRewriteMediaUrls(nodes, opts);
}
