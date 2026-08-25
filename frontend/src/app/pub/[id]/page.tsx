import { cache } from "react";
import crypto from "crypto";
import net from "net";
import Link from "next/link";
import { headers } from "next/headers";
import { Config } from "@/config";
import { HeadLangPatcher } from "@/components/HeadLangPatcher";
import PubServiceHeader from "@/components/PubServiceHeader";
import { getPubPost, listPubPostsByIds, listPubPostsByUser } from "@/api/posts";
import { getPubConfig, getPubRanking } from "@/api/users";
import {
  makePubArticleHtmlFromMarkdown,
  makeHtmlFromJsonSnippet,
  makeSnippetHtmlFromMarkdown,
} from "@/utils/article";
import LinkDiv from "@/components/LinkDiv";
import ArticleWithDecoration from "@/components/ArticleWithDecoration";
import { formatDateTime, makeAbsoluteUrl, convertForDirection } from "@/utils/format";
import { parseDateString } from "@/utils/parse";
import PubImageBlockBinder from "@/components/PubImageBlockBinder";
import PubScrollAction from "@/components/PubScrollAction";
import PubTrackMapHydrator from "@/components/PubTrackMapHydrator";
import PubShareButtons from "@/components/PubShareButtons";
import type { Post } from "@/api/models";
import type { Metadata } from "next";

type PageParams = { id: string };

const SELF_IDENTIFIED_BOT_USER_AGENT =
  /(?:bot\b|crawler|spider|slurp|facebookexternalhit|bingpreview|google-inspection-tool|googleother)/iu;

function normalizeClientIp(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end > 0) value = value.slice(1, end);
  } else if (value.includes(".") && /:\d+$/.test(value)) {
    value = value.replace(/:\d+$/, "");
  }
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  return net.isIP(value) ? value : null;
}

async function getPubViewHeaders(postId: string): Promise<{
  fingerprint: string;
  signature: string;
} | null> {
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent") ?? "";
  if (SELF_IDENTIFIED_BOT_USER_AGENT.test(userAgent)) return null;

  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0] ?? "";
  const clientIp =
    normalizeClientIp(forwarded) ??
    normalizeClientIp(requestHeaders.get("x-real-ip") ?? "") ??
    normalizeClientIp(requestHeaders.get("cf-connecting-ip") ?? "");
  if (!clientIp) return null;

  const secret = process.env.STGY_REDIS_PASSWORD || "*";
  const fingerprint = crypto
    .createHmac("sha256", secret)
    .update(clientIp)
    .digest()
    .subarray(0, 4)
    .toString("hex");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${postId.toUpperCase()}\n${fingerprint}`)
    .digest("hex");
  return { fingerprint, signature };
}

const getPubPageData = cache(async (id: string, fingerprint: string, signature: string) => {
  const post = await getPubPost(
    id,
    fingerprint && signature ? { fingerprint, signature } : undefined,
  );
  const pubcfg = await getPubConfig(post.ownedBy);
  const article = makePubArticleHtmlFromMarkdown(post.content);
  return { post, pubcfg, article };
});

async function listPopularPosts(userId: string, limit: number): Promise<Post[]> {
  const ranking = await getPubRanking(userId, limit);
  if (ranking.length === 0) return [];
  return listPubPostsByIds(ranking.map((entry) => entry.id));
}

async function loadPubPageData(id: string) {
  const view = await getPubViewHeaders(id);
  return getPubPageData(id, view?.fingerprint ?? "", view?.signature ?? "");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const { post, pubcfg, article } = await loadPubPageData(id);
    const locale = post.locale || pubcfg.locale || "und";
    const artTitle =
      article.title || "POST@" + new Date(post.publishedAt ?? "").toISOString().slice(0, 10);
    const artDesc = article.desc || artTitle;
    const siteName = pubcfg.siteName?.trim() || "";
    const pageTitle = siteName ? `${siteName}: ${artTitle}` : artTitle;
    const author = (article.metadata.author || pubcfg.author || "").trim();
    const metaDate = parseDateString(article.metadata.date ?? "");
    const metaDateIso = metaDate ? metaDate.toISOString() : undefined;
    const createdDate = metaDate || parseDateString(post.createdAt);
    const createdAtIso = createdDate ? createdDate.toISOString() : undefined;
    const issuedAt = post.publishedAt ?? undefined;
    const canonical = makeAbsoluteUrl(`/pub/${post.id}`);
    const featuredImageUrl =
      article.featured && typeof article.featured === "string"
        ? makeAbsoluteUrl(article.featured)
        : undefined;

    return {
      title: pageTitle,
      description: artDesc,
      alternates: { canonical },
      openGraph: {
        title: artTitle,
        siteName: siteName || undefined,
        description: artDesc,
        type: "article",
        locale,
        authors: author ? [author] : undefined,
        publishedTime: post.publishedAt ?? undefined,
        images: featuredImageUrl ? [{ url: featuredImageUrl }] : undefined,
      },
      twitter: {
        card: "summary",
        title: artTitle,
        description: artDesc,
        creator: author || undefined,
        images: featuredImageUrl ? [featuredImageUrl] : undefined,
      },
      authors: author ? [{ name: author }] : undefined,
      other: {
        ...(article.title ? { "dc:title": article.title } : {}),
        ...(metaDateIso ? { "dc:date": metaDateIso } : {}),
        ...(createdAtIso ? { "dcterms:created": createdAtIso } : {}),
        ...(issuedAt ? { "dcterms:issued": issuedAt } : {}),
      },
    };
  } catch (e: unknown) {
    const canonical = makeAbsoluteUrl(`/pub/${id}`);
    const msg = e instanceof Error ? e.message : String(e ?? "");
    const is404 = /(^|\b)404(\b|$)/.test(msg) || /not\s*found/i.test(msg) || /no\s*such/i.test(msg);

    if (is404) {
      return {
        title: "Not found",
        description: "This publication page does not exist.",
        alternates: { canonical },
        robots: { index: false, follow: false },
        openGraph: { title: "Not found", type: "article" },
        twitter: { card: "summary", title: "Not found" },
      };
    }
    return {
      title: "Error",
      description: "Failed to load the publication page.",
      alternates: { canonical },
      robots: { index: false, follow: false },
    };
  }
}

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ design?: string }> };

export default async function PubPostPage({ params, searchParams }: Props) {
  const { id } = await params;
  const qs = (await searchParams) || {};
  const designRaw = qs.design;
  const design = Array.isArray(designRaw) ? designRaw[0] : designRaw;

  try {
    const { post, pubcfg, article: horizontalArticle } = await loadPubPageData(id);
    const baseTheme = Config.PUB_DESIGN_THEMES.includes(pubcfg.designTheme ?? "")
      ? pubcfg.designTheme
      : "default";
    const theme =
      typeof design === "string" && Config.PUB_DESIGN_THEMES.includes(design) ? design : baseTheme;
    const themeDir = Config.PUB_DESIGN_VERTICAL_THEMES.includes(theme) ? "vert" : "norm";
    const themeTone = Config.PUB_DESIGN_DARK_THEMES.includes(theme) ? "dark" : "light";
    const writingMode = themeDir === "vert" ? "vertical" : "horizontal";
    const article =
      writingMode === "vertical"
        ? makePubArticleHtmlFromMarkdown(post.content, undefined, { writingMode })
        : horizontalArticle;
    const siteIntroHtml = makeSnippetHtmlFromMarkdown(
      pubcfg.introduction.trim() || "my publications",
      undefined,
      { writingMode },
    );
    const recentCount = Math.max(
      0,
      Math.min(Config.PUB_SIDE_POSTS_MAX, Math.trunc(pubcfg.showSideRecent)),
    );
    const popularCount = Math.max(
      0,
      Math.min(Config.PUB_SIDE_POSTS_MAX, Math.trunc(pubcfg.showSidePopular)),
    );
    const [recentRaw, popular] = await Promise.all([
      recentCount > 0
        ? listPubPostsByUser(post.ownedBy, {
            offset: 0,
            limit: recentCount + 1,
            order: "desc",
          })
        : Promise.resolve([]),
      popularCount > 0
        ? listPopularPosts(post.ownedBy, popularCount).catch(() => [])
        : Promise.resolve([]),
    ]);
    const recent = recentRaw
      .filter((r) => String(r.id) !== String(post.id))
      .slice(0, recentCount);
    const siteHrefBase = `/sites/${post.ownedBy}`;
    const siteHref = design ? `${siteHrefBase}?design=${encodeURIComponent(design)}` : siteHrefBase;
    const siteHrefWithPostsControls = `${siteHref}#pub-posts-controls`;
    const locale = post.locale || pubcfg.locale || "und";
    const newerHref = post.newerPostId
      ? `/pub/${post.newerPostId}${design ? `?design=${encodeURIComponent(design)}` : ""}`
      : "";
    const olderHref = post.olderPostId
      ? `/pub/${post.olderPostId}${design ? `?design=${encodeURIComponent(design)}` : ""}`
      : "";
    const hasTrackMap = article.html.includes("stgy-track-map");
    const enabledShareButtons = pubcfg.extensions.shareButtons ?? [];
    const hasShareButtons = ["x", "facebook", "hatena"].some((service) =>
      enabledShareButtons.includes(service),
    );
    const shareUrl = makeAbsoluteUrl(`/pub/${post.id}`);
    const shareTitle = article.title || pubcfg.siteName.trim() || "STGY Publications";
    const articleNode = (
      <ArticleWithDecoration
        lang={locale}
        className={`markdown-body post-content${hasShareButtons ? " pub-post-content-with-share" : ""}`}
        html={article.html}
      />
    );

    return (
      <div
        className={`pub-page pub-theme-${theme} pub-theme-dir-${themeDir} pub-theme-tone-${themeTone}`}
      >
        <HeadLangPatcher lang={locale} />
        <PubServiceHeader
          showServiceHeader={pubcfg.showServiceHeader}
          redirectTo={`/posts/${post.id}`}
          viewAsHref={`/posts/${post.id}`}
          post={post}
        />
        <main className="pub-container" lang={locale}>
          {pubcfg.showSiteName && (
            <div className="pub-site-name-region">
              <h1 className="pub-site-name">
                <a href={siteHref}>{pubcfg.siteName.trim() || "STGY Publications"}</a>
              </h1>
              {pubcfg.subtitle?.trim() && (
                <div className="pub-subtitle">{pubcfg.subtitle.trim()}</div>
              )}
            </div>
          )}
          <div className="pub-layout">
            <section className="pub-main">
              <div className="date">
                {convertForDirection(formatDateTime(new Date(post.publishedAt ?? "")), themeDir)}
              </div>
              {hasShareButtons ? (
                <div className="pub-article-with-share">
                  {articleNode}
                  <PubShareButtons
                    enabled={enabledShareButtons}
                    url={shareUrl}
                    title={shareTitle}
                    locale={locale}
                  />
                </div>
              ) : (
                articleNode
              )}
              {hasTrackMap && <PubTrackMapHydrator htmlKey={String(post.id)} />}
              {pubcfg.showPagenation && (
                <nav className="pub-pager" aria-label="Pagination">
                  <div className="pager-row">
                    {post.newerPostId ? (
                      <a className="pager-btn" href={newerHref}>
                        {convertForDirection("← Newer", themeDir)}
                      </a>
                    ) : (
                      <span className="pager-btn disabled" aria-disabled="true">
                        {convertForDirection("← Newer", themeDir)}
                      </span>
                    )}
                    {post.olderPostId ? (
                      <a className="pager-btn" href={olderHref}>
                        {convertForDirection("Older →", themeDir)}
                      </a>
                    ) : (
                      <span className="pager-btn disabled" aria-disabled="true">
                        {convertForDirection("Older →", themeDir)}
                      </span>
                    )}
                  </div>
                </nav>
              )}
            </section>
            {(pubcfg.showSideProfile || recent.length > 0 || popular.length > 0) && (
              <aside className="pub-sidebar">
                {pubcfg.showSideProfile && (
                  <section className="pub-side-profile">
                    <h2 className="side-header">{convertForDirection("Profile", themeDir)}</h2>
                    <LinkDiv href={siteHref} className="link-div">
                      <ArticleWithDecoration
                        lang={pubcfg.locale || locale}
                        className="markdown-body post-content-excerpt site-intro"
                        html={siteIntroHtml}
                      />
                    </LinkDiv>
                  </section>
                )}
                {recent.length > 0 && (
                  <section className="pub-side-recent">
                    <h2 className="side-header">{convertForDirection("Recent posts", themeDir)}</h2>
                    {recent.map((r, idx) => {
                      const postHref = `/pub/${r.id}${
                        design ? `?design=${encodeURIComponent(design)}` : ""
                      }`;
                      const snippetHtml = makeHtmlFromJsonSnippet(
                        r.snippet,
                        `p${idx + 1}-h`,
                        {
                          moveLeadingFeaturedAfterHeading: true,
                          writingMode,
                        },
                      );
                      return (
                        <LinkDiv key={String(r.id)} href={postHref} className="link-div">
                          <ArticleWithDecoration
                            lang={r.locale || pubcfg.locale || locale}
                            className="markdown-body post-content-excerpt"
                            html={snippetHtml}
                          />
                        </LinkDiv>
                      );
                    })}
                    <nav className="recent-nav">
                      <a className="pager-btn" href={siteHrefWithPostsControls}>
                        {convertForDirection("more", themeDir)}
                      </a>
                    </nav>
                  </section>
                )}
                {popular.length > 0 && (
                  <section className="pub-side-recent pub-side-popular">
                    <h2 className="side-header">
                      {convertForDirection("Popular entries", themeDir)}
                    </h2>
                    {popular.map((entry, idx) => {
                      const postHref = `/pub/${entry.id}${
                        design ? `?design=${encodeURIComponent(design)}` : ""
                      }`;
                      const snippetHtml = makeHtmlFromJsonSnippet(
                        entry.snippet,
                        `pp${idx + 1}-h`,
                        {
                          moveLeadingFeaturedAfterHeading: true,
                          writingMode,
                        },
                      );
                      return (
                        <LinkDiv key={entry.id} href={postHref} className="link-div">
                          <ArticleWithDecoration
                            lang={entry.locale || pubcfg.locale || locale}
                            className="markdown-body post-content-excerpt"
                            html={snippetHtml}
                          />
                        </LinkDiv>
                      );
                    })}
                  </section>
                )}
                <section className="pub-side-search">
                  <h2 className="side-header">
                    {convertForDirection("Search posts", themeDir)}
                  </h2>
                  <form className="pub-side-search-form" action={siteHrefBase} method="get">
                    {design && <input type="hidden" name="design" value={design} />}
                    <input
                      className="pub-side-search-input"
                      type="search"
                      name="q"
                      aria-label="Search posts"
                    />
                    <button className="pub-side-search-button" type="submit" aria-label="Search posts">
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M16 16l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </form>
                </section>
              </aside>
            )}
          </div>
        </main>
        <PubImageBlockBinder />
        <PubScrollAction selectors={[".pub-container"]} />
      </div>
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load";
    const is404 =
      /(^|\b)404(\b|$)/.test(String(msg)) || /not\s*found/i.test(msg) || /no\s*such/i.test(msg);

    return (
      <div className="pub-page pub-theme-default">
        <PubServiceHeader showServiceHeader={true} />
        <main className="pub-container" lang="und">
          <h1>{is404 ? "Not found" : "Error"}</h1>
          {is404 ? (
            <>
              <p>This publication page doesn’t exist or is private.</p>
              <p>
                <Link className="pager-btn" href="/">
                  Go to Home
                </Link>
              </p>
            </>
          ) : (
            <pre>{msg}</pre>
          )}
        </main>
      </div>
    );
  }
}
