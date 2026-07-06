"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import PrismHighlighter from "@/components/PrismHighlighter";
import { stopTrackMapEvent, useTrackMapHydrator } from "@/hooks/useTrackMapHydrator";

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
  const prismDeps = useMemo(() => [html], [html]);
  const hasTrackMap = hydrateMaps && html.includes("stgy-track-map");

  useEffect(() => {
    if (!hasTrackMap) return;
    const root = rootRef.current;
    if (!root) return;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => hydrateTrackMaps(root));
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2) cancelAnimationFrame(id2);
    };
  }, [html, hasTrackMap, hydrateTrackMaps]);

  return (
    <>
      <div
        ref={rootRef}
        lang={lang}
        className={className}
        style={{ minHeight, userSelect }}
        onPointerDown={stopTrackMapEvent}
        onTouchStart={stopTrackMapEvent}
        onMouseDown={stopTrackMapEvent}
        onClick={stopTrackMapEvent}
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
