"use client";

import type { KwicData, KwicInlineNode } from "stgy-markdown";

const HIGHLIGHT_COLORS = [
  "#fff6c7", // pastel yellow
  "#ffe2ec", // pastel pink
  "#e2f3ff", // pastel light blue
  "#e4f5e8", // pastel green
  "#ffe8cf", // pastel orange
  "#eee3ff", // pastel purple
] as const;

export function KwicInlineNodes({ nodes }: { nodes: readonly KwicInlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) =>
        node.type === "highlight" ? (
          <mark
            key={index}
            className="rounded-sm px-0.5 text-inherit"
            style={{
              backgroundColor:
                HIGHLIGHT_COLORS[node.keywordIndex % HIGHLIGHT_COLORS.length],
              color: "inherit",
            }}
          >
            {node.text}
          </mark>
        ) : (
          <span key={index}>{node.text}</span>
        ),
      )}
    </>
  );
}

export default function KwicBody({
  kwic,
  showTitle = true,
  className = "space-y-1 text-sm leading-relaxed text-gray-700",
  titleClassName = "text-[1.2em] font-medium text-gray-900",
  emptyClassName = "text-gray-400",
}: {
  kwic: KwicData;
  showTitle?: boolean;
  className?: string;
  titleClassName?: string;
  emptyClassName?: string;
}) {
  const segments = kwic.segments;
  return (
    <div className={className}>
      {showTitle && kwic.title && kwic.title.length > 0 && (
        <div className={titleClassName}>
          <KwicInlineNodes nodes={kwic.title} />
        </div>
      )}
      {segments.length > 0 && (
        <div>
          {!segments[0].isStart && <span aria-hidden>…</span>}
          {segments.map((segment, index) => (
            <span key={`${segment.startPosition}-${segment.endPosition}`}>
              {index > 0 && <span aria-hidden> … </span>}
              <KwicInlineNodes nodes={segment.children} />
            </span>
          ))}
          {!segments[segments.length - 1].isEnd && <span aria-hidden>…</span>}
        </div>
      )}
      {(!kwic.title || kwic.title.length === 0) && segments.length === 0 && (
        <div className={emptyClassName}>No matching context.</div>
      )}
    </div>
  );
}
