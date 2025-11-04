import { cache } from "react";
import Link from "next/link";
import { Config } from "@/config";
import { HeadLangPatcher } from "@/components/HeadLangPatcher";
import PubServiceHeader from "@/components/PubServiceHeader";
import { getPubPost, listPubPostsByUser } from "@/api/posts";
import { getPubConfig } from "@/api/users";
import {
  makePubArticleHtmlFromMarkdown,
  makeHtmlFromJsonSnippet,
  makeSnippetHtmlFromMarkdown,
} from "@/utils/article";
import LinkDiv from "@/components/LinkDiv";
import ArticleWithDecoration from "@/components/ArticleWithDecoration";
import { formatDateTime, makeAbsoluteUrl } from "@/utils/format";
import type { Metadata } from "next";

type PageParams = { id: string };

const getPubPageData = cache(async (id: string) => {
  const post = await getPubPost(id); // throws Error(message) when not found
  const pubcfg = await getPubConfig(post.ownedBy);
  const article = makePubArticleHtmlFromMarkdown(post.content);
  return { post, pubcfg, article };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const { post, pubcfg, article } = await getPubPageData(id);
    const locale = post.locale || pubcfg.locale || "und";
    const artTitle =
      article.title || "POST@" + new Date(post.publishedAt ?? "").toISOString().slice(0, 10);
    const artDesc = article.desc || artTitle;
    const siteName = pubcfg.siteName?.trim() || "";
    const pageTitle = siteName ? `${siteName}: ${artTitle}` : artTitle;
    const author = (pubcfg.author || "").trim();
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

type Props = { params: Promise<{ id: string }> };

export default async function PubPostPage({ params }: Props) {
  const { id } = await params;
  try {
    const { post, pubcfg, article } = await getPubPageData(id);
    const theme = Config.PUB_DESIGN_DARK_THEMES.includes(pubcfg.designTheme ?? "")
      ? pubcfg.designTheme
      : "default";
    const themeKind = Config.PUB_DESIGN_DARK_THEMES.includes(theme) ? "dark" : "light";
    const siteIntroHtml = makeSnippetHtmlFromMarkdown(
      pubcfg.introduction.trim() || "my publications",
    );
   let recent: Awaited<ReturnType<typeof listPubPostsByUser>> = [];
    if (pubcfg.showSideRecent) {
      const desired = Config.PUB_SIDE_RECENT_POSTS_SIZE;
      recent = await listPubPostsByUser(post.ownedBy, {
        offset: 0,
        limit: desired + 1,
        order: "desc",
      });
      recent = recent.filter((r) => String(r.id) !== String(post.id)).slice(0, desired);
    }
    const siteHref = `/pub/sites/${post.ownedBy}`;
    const locale = post.locale || pubcfg.locale || "und";

    return (
      <div className={`pub-page pub-theme-${theme} pub-theme-kind-${themeKind}`}>
        <HeadLangPatcher lang={locale} />
        <PubServiceHeader
          showServiceHeader={pubcfg.showServiceHeader}
          redirectTo={`/posts/${post.id}`}
          viewAsHref={`/posts/${post.id}`}
          post={post}
        />
        <main className="pub-container" lang={locale}>
          {pubcfg.showSiteName && (
            <>
              <h1 className="pub-site-name">
                <a href={siteHref}>{pubcfg.siteName.trim() || "STGY Publications"}</a>
              </h1>
              {pubcfg.subtitle?.trim() && (
                <div className="pub-subtitle">{pubcfg.subtitle.trim()}</div>
              )}
            </>
          )}
          <div className="pub-layout">
            <section className="pub-main">
              <div className="date">{formatDateTime(new Date(post.publishedAt ?? ""))}</div>
              <ArticleWithDecoration
                lang={locale}
                className="markdown-body post-content"
                html={article.html}
              />
              {pubcfg.showPagenation && (
                <nav className="pub-pager" aria-label="Pagination">
                  <div className="pager-row">
                    {post.newerPostId ? (
                      <a className="pager-btn" href={`/pub/${post.newerPostId}`}>
                        ← Newer
                      </a>
                    ) : (
                      <span className="pager-btn disabled" aria-disabled="true">
                        ← Newer
                      </span>
                    )}
                    {post.olderPostId ? (
                      <a className="pager-btn" href={`/pub/${post.olderPostId}`}>
                        Older →
                      </a>
                    ) : (
                      <span className="pager-btn disabled" aria-disabled="true">
                        Older →
                      </span>
                    )}
                  </div>
                </nav>
              )}
            </section>
            {(pubcfg.showSideProfile || recent.length > 0) && (
              <aside className="pub-sidebar">
                {pubcfg.showSideProfile && (
                  <section className="pub-side-profile">
                    <h2 className="side-header">Profile</h2>
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
                    <h2 className="side-header">Recent posts</h2>
                    {recent.map((r, idx) => {
                      const postHref = `/pub/${r.id}`;
                      const snippetHtml = makeHtmlFromJsonSnippet(r.snippet, `p${idx + 1}-h`);
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
                  </section>
                )}
              </aside>
            )}
          </div>
        </main>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof window==="undefined")return;if(window.__stgyImageBlockBound)return;window.__stgyImageBlockBound=true;document.body.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest)return;var b=t.closest(".image-block");if(b){b.classList.toggle("expanded");e.stopPropagation();}});})();`,
          }}
        />
      </div>
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load";
    const is404 =
      /(^|\b)404(\b|$)/.test(String(msg)) ||
      /not\s*found/i.test(String(msg)) ||
      /no\s*such/i.test(String(msg));

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
