"use client";

import { memo, useEffect, useMemo, useRef, type SyntheticEvent } from "react";
import PrismHighlighter from "@/components/PrismHighlighter";
import { stopTrackMapEvent, useTrackMapHydrator } from "@/hooks/useTrackMapHydrator";
import { useLinkSnippetHydrator } from "@/hooks/useLinkSnippetHydrator";

function stopMarkdownBodyEvent(event: SyntheticEvent): void {
  stopTrackMapEvent(event);
  const target = event.target;
  if (target instanceof Element && target.closest(".stgy-link-snippet")) {
    event.stopPropagation();
  }
}

type MarkdownHtmlBodyProps = {
  html: string;
  lang?: string;
  className: string;
  minHeight?: number;
  userSelect?: "auto" | "text" | "none";
  hydrateMaps?: boolean;
  highlightCode?: boolean;
};

function MarkdownHtmlBodyImpl({
  html,
  lang,
  className,
  minHeight,
  userSelect = "text",
  hydrateMaps = true,
  highlightCode = true,
}: MarkdownHtmlBodyProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hydrateTrackMaps = useTrackMapHydrator();
  const hydrateLinkSnippets = useLinkSnippetHydrator();
  const prismDeps = useMemo(() => [html], [html]);
  const hasTrackMap = hydrateMaps && html.includes("stgy-track-map");
  const hasLinkSnippet = html.includes("stgy-link-snippet");

  useEffect(() => {
    if (!hasTrackMap && !hasLinkSnippet) return;
    const root = rootRef.current;
    if (!root) return;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        if (hasTrackMap) hydrateTrackMaps(root);
        if (hasLinkSnippet) hydrateLinkSnippets(root);
      });
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2) cancelAnimationFrame(id2);
    };
  }, [
    html,
    hasTrackMap,
    hasLinkSnippet,
    hydrateTrackMaps,
    hydrateLinkSnippets,
  ]);

  return (
    <>
      <div
        ref={rootRef}
        lang={lang}
        className={className}
        style={{ minHeight, userSelect }}
        onPointerDown={stopMarkdownBodyEvent}
        onTouchStart={stopMarkdownBodyEvent}
        onMouseDown={stopMarkdownBodyEvent}
        onClick={stopMarkdownBodyEvent}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {highlightCode && <PrismHighlighter root={rootRef.current} deps={prismDeps} />}
    </>
  );
}

const MarkdownHtmlBody = memo(
  MarkdownHtmlBodyImpl,
  (prev, next) =>
    prev.html === next.html &&
    prev.lang === next.lang &&
    prev.className === next.className &&
    prev.minHeight === next.minHeight &&
    prev.userSelect === next.userSelect &&
    prev.hydrateMaps === next.hydrateMaps &&
    prev.highlightCode === next.highlightCode,
);

export default MarkdownHtmlBody;
