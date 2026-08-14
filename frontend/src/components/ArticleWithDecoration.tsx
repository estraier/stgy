"use client";

import React from "react";
import PrismHighlighter from "@/components/PrismHighlighter";
import { ensureMathJaxReady, patchMathInlineInContainer } from "@/utils/mathjax-inline";
import { useLinkSnippetHydrator } from "@/hooks/useLinkSnippetHydrator";

type BaseProps = Omit<React.HTMLAttributes<HTMLElement>, "dangerouslySetInnerHTML">;

type Props = BaseProps & {
  html: string;
  lang?: string;
  as?: "article" | "div" | "section";
};

export default function ArticleWithDecoration({
  html,
  lang,
  as = "article",
  className,
  ...rest
}: Props) {
  const ref = React.useRef<HTMLElement | null>(null);
  const hydrateLinkSnippets = useLinkSnippetHydrator();

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    hydrateLinkSnippets(el);
  });

  React.useEffect(() => {
    ensureMathJaxReady().then(() => {
      const cur = ref.current;
      if (!cur) return;
      patchMathInlineInContainer(cur);
    });
  }, [html]);

  const prismDeps = React.useMemo(() => [html], [html]);
  const Element = as;

  const setRef = React.useCallback((node: HTMLElement | null) => {
    ref.current = node;
  }, []);

  return (
    <>
      <Element
        ref={setRef}
        lang={lang}
        className={className}
        {...rest}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <PrismHighlighter root={ref.current} deps={prismDeps} />
    </>
  );
}
