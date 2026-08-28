"use client";

import React from "react";
import Link from "next/link";
import { getPubPostsKwic, searchPubPostsByUser } from "@/api/posts";
import type { Post } from "@/api/models";
import {
  makeHtmlFromJsonSnippet,
  makePubAttributesFromJsonSnippet,
} from "@/utils/article";
import { convertForDirection, formatDateTime, makeAbsoluteUrl } from "@/utils/format";
import ArticleWithDecoration from "@/components/ArticleWithDecoration";
import PubShareButtons from "@/components/PubShareButtons";
import LinkDiv from "@/components/LinkDiv";
import KwicBody from "@/components/KwicBody";
import type { KwicData } from "stgy-markdown";

type Props = {
  userId: string;
  query: string;
  page: number;
  pageSize: number;
  tabMode: "kwic" | "rich" | "plain";
  design?: string;
  writingMode: "horizontal" | "vertical";
  themeDir: "norm" | "vert";
  locale: string;
  pubLocale?: string | null;
  shareButtons: readonly string[];
  siteTitle: string;
};

export default function PubSiteSearchResults({
  userId,
  query,
  page,
  pageSize,
  tabMode,
  design,
  writingMode,
  themeDir,
  locale,
  pubLocale,
  shareButtons,
  siteTitle,
}: Props) {
  const [posts, setPosts] = React.useState<Post[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [kwicByPostId, setKwicByPostId] = React.useState<Record<string, KwicData>>({});
  const [kwicLoading, setKwicLoading] = React.useState(false);
  const [kwicError, setKwicError] = React.useState<string | null>(null);
  const [searchPhrases, setSearchPhrases] = React.useState<string[]>([]);
  const kwicKeywords = searchPhrases;
  const hasShareButtons = ["x", "facebook", "line", "hatena"].some((service) =>
    shareButtons.includes(service),
  );

  React.useEffect(() => {
    let active = true;
    setPosts(null);
    setSearchPhrases([]);
    setError(null);

    searchPubPostsByUser({
      query,
      userId,
      offset: (page - 1) * pageSize,
      limit: pageSize + 1,
      locale: pubLocale || locale,
      order: "desc",
    })
      .then((searchResult) => {
        if (!active) return;
        setSearchPhrases(searchResult.phrases);
        setPosts(searchResult.result);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e ?? "Failed to search"));
      });

    return () => {
      active = false;
    };
  }, [locale, page, pageSize, pubLocale, query, userId]);

  React.useEffect(() => {
    let active = true;
    setKwicByPostId({});
    setKwicError(null);
    setKwicLoading(false);

    if (tabMode !== "kwic" || !posts || posts.length === 0 || kwicKeywords.length === 0) {
      return () => {
        active = false;
      };
    }

    const ids = posts.slice(0, pageSize).map((post) => post.id);
    if (ids.length === 0) {
      return () => {
        active = false;
      };
    }

    setKwicLoading(true);
    getPubPostsKwic(ids, kwicKeywords)
      .then((items) => {
        if (!active) return;
        const next: Record<string, KwicData> = {};
        for (const item of items) next[item.id] = item.kwic;
        setKwicByPostId(next);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setKwicError(e instanceof Error ? e.message : String(e ?? "Failed to load KWIC"));
      })
      .finally(() => {
        if (active) setKwicLoading(false);
      });

    return () => {
      active = false;
    };
  }, [kwicKeywords, pageSize, posts, tabMode]);

  const buildPageHref = React.useCallback(
    (p: number) => {
      const qs = new URLSearchParams();
      qs.set("page", String(p));
      if (design) qs.set("design", design);
      if (tabMode === "plain") qs.set("tab", "plain");
      if (tabMode === "rich") qs.set("tab", "rich");
      qs.set("q", query);
      return `/sites/${userId}?${qs.toString()}#pub-posts-controls`;
    },
    [design, query, tabMode, userId],
  );

  if (error) {
    return <p className="pub-search-status">{error}</p>;
  }
  if (posts === null) {
    return <p className="pub-search-status">Searching...</p>;
  }

  const hasPrev = page > 1;
  const hasNext = posts.length > pageSize;
  const items = posts.slice(0, pageSize);

  return (
    <>
      <section className="site-recent" id="pub-post-list">
        {items.length === 0 ? (
          <p className="pub-search-status">No posts found.</p>
        ) : tabMode === "plain" ? (
          <ul className="pub-post-list">
            {items.map((r) => {
              const postHref = `/pub/${r.id}${design ? `?design=${encodeURIComponent(design)}` : ""}`;
              const publishedAtDate = new Date(r.publishedAt ?? "");
              const attrs = makePubAttributesFromJsonSnippet(r.snippet, { writingMode });
              return (
                <li
                  key={String(r.id)}
                  className="post-div post-list-item"
                  id={`pubpost-${r.id}`}
                  data-restore-id={String(r.id)}
                  data-restore-page={String(page)}
                >
                  <span className="date">
                    {convertForDirection(
                      formatDateTime(publishedAtDate).replace(/\s.*$/, ""),
                      themeDir,
                    )}
                  </span>{" "}
                  <Link href={postHref}>
                    {attrs.title && <strong className="title">{attrs.title}</strong>}
                    {attrs.metadata.author && <em className="author">{attrs.metadata.author}</em>}
                    {attrs.desc}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : tabMode === "kwic" ? (
          items.map((r) => {
            const postHref = `/pub/${r.id}${design ? `?design=${encodeURIComponent(design)}` : ""}`;
            const publishedAtDate = new Date(r.publishedAt ?? "");
            return (
              <LinkDiv
                key={String(r.id)}
                href={postHref}
                className="link-div post-div"
                id={`pubpost-${r.id}`}
                data-restore-id={String(r.id)}
                data-restore-page={String(page)}
              >
                <div className="date">
                  {convertForDirection(formatDateTime(publishedAtDate), themeDir)}
                </div>
                <div className="markdown-body post-content-excerpt pub-kwic-body">
                  {kwicByPostId[r.id] ? (
                    <KwicBody
                      kwic={kwicByPostId[r.id]}
                      className="space-y-1 text-sm leading-relaxed"
                      titleClassName="text-[1.2em] font-bold"
                      emptyClassName="opacity-60"
                    />
                  ) : kwicLoading ? (
                    <span className="pub-search-status">Loading...</span>
                  ) : (
                    <span className="pub-search-status">
                      {kwicError ? "KWIC unavailable." : "No matching context."}
                    </span>
                  )}
                </div>
              </LinkDiv>
            );
          })
        ) : (
          items.map((r, idx) => {
            const postHref = `/pub/${r.id}${design ? `?design=${encodeURIComponent(design)}` : ""}`;
            const snippetHtml = makeHtmlFromJsonSnippet(r.snippet, `p${idx + 1}-h`, {
              writingMode,
            });
            const publishedAtDate = new Date(r.publishedAt ?? "");
            const shareTitle = hasShareButtons
              ? makePubAttributesFromJsonSnippet(r.snippet).title || siteTitle
              : siteTitle;
            return (
              <LinkDiv
                key={String(r.id)}
                href={postHref}
                className={`link-div post-div${
                  hasShareButtons ? " pub-site-rich-post-with-share" : ""
                }`}
                id={`pubpost-${r.id}`}
                data-restore-id={String(r.id)}
                data-restore-page={String(page)}
              >
                <div className="date">
                  {convertForDirection(formatDateTime(publishedAtDate), themeDir)}
                </div>
                <ArticleWithDecoration
                  lang={r.locale || pubLocale || locale}
                  className={`markdown-body post-content-excerpt${
                    hasShareButtons ? " pub-site-post-content-with-share" : ""
                  }`}
                  html={snippetHtml}
                />
                {hasShareButtons && (
                  <PubShareButtons
                    enabled={shareButtons}
                    url={makeAbsoluteUrl(`/pub/${r.id}`)}
                    title={shareTitle}
                    locale={r.locale || pubLocale || locale}
                    vertical={themeDir === "vert"}
                  />
                )}
              </LinkDiv>
            );
          })
        )}
      </section>
      <nav className="pub-pager" aria-label="Pagination">
        <div className="pager-row">
          {hasPrev ? (
            <Link className="pager-btn" href={buildPageHref(page - 1)}>
              {convertForDirection("← Newer", themeDir)}
            </Link>
          ) : (
            <span className="pager-btn disabled" aria-disabled="true">
              {convertForDirection("← Newer", themeDir)}
            </span>
          )}
          {hasNext ? (
            <Link className="pager-btn" href={buildPageHref(page + 1)}>
              {convertForDirection("Older →", themeDir)}
            </Link>
          ) : (
            <span className="pager-btn disabled" aria-disabled="true">
              {convertForDirection("Older →", themeDir)}
            </span>
          )}
        </div>
      </nav>
    </>
  );
}
