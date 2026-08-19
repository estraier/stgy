"use client";

import React from "react";
import Link from "next/link";
import { searchPubPostsByUser } from "@/api/posts";
import type { Post } from "@/api/models";
import {
  makeHtmlFromJsonSnippet,
  makePubAttributesFromJsonSnippet,
} from "@/utils/article";
import { convertForDirection, formatDateTime } from "@/utils/format";
import ArticleWithDecoration from "@/components/ArticleWithDecoration";
import LinkDiv from "@/components/LinkDiv";

type Props = {
  userId: string;
  query: string;
  page: number;
  pageSize: number;
  order: "asc" | "desc";
  tabMode: "snippet" | "plain";
  design?: string;
  writingMode: "horizontal" | "vertical";
  themeDir: "norm" | "vert";
  locale: string;
  pubLocale?: string | null;
};

export default function PubSiteSearchResults({
  userId,
  query,
  page,
  pageSize,
  order,
  tabMode,
  design,
  writingMode,
  themeDir,
  locale,
  pubLocale,
}: Props) {
  const [posts, setPosts] = React.useState<Post[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setPosts(null);
    setError(null);

    searchPubPostsByUser({
      query,
      userId,
      offset: (page - 1) * pageSize,
      limit: pageSize + 1,
      locale: pubLocale || locale,
      order,
    })
      .then((result) => {
        if (active) setPosts(result);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e ?? "Failed to search"));
      });

    return () => {
      active = false;
    };
  }, [locale, order, page, pageSize, pubLocale, query, userId]);

  const buildPageHref = React.useCallback(
    (p: number) => {
      const qs = new URLSearchParams();
      qs.set("page", String(p));
      if (design) qs.set("design", design);
      if (tabMode === "plain") qs.set("tab", "plain");
      if (order === "asc") qs.set("oldestFirst", "1");
      qs.set("q", query);
      return `/sites/${userId}?${qs.toString()}#pub-posts-controls`;
    },
    [design, order, query, tabMode, userId],
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
        {tabMode === "plain" ? (
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
        ) : (
          items.map((r, idx) => {
            const postHref = `/pub/${r.id}${design ? `?design=${encodeURIComponent(design)}` : ""}`;
            const snippetHtml = makeHtmlFromJsonSnippet(r.snippet, `p${idx + 1}-h`, {
              writingMode,
            });
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
                <ArticleWithDecoration
                  lang={r.locale || pubLocale || locale}
                  className="markdown-body post-content-excerpt"
                  html={snippetHtml}
                />
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
