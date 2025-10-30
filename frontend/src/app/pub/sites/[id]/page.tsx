import { cache } from "react";
import { Config } from "@/config";
import PubServiceHeader from "@/components/PubServiceHeader";
import { listPubPostsByUser } from "@/api/posts";
import { getPubConfig } from "@/api/users";
import { makePubArticleHtmlFromMarkdown, makeHtmlFromJsonSnippet } from "@/utils/article";
import LinkDiv from "@/components/LinkDiv";
import ArticleWithDecoration from "@/components/ArticleWithDecoration";
import { formatDateTime } from "@/utils/format";
import type { Metadata } from "next";

type PageParams = { id: string };

const getPubSiteData = cache(async (id: string) => {
  const pubcfg = await getPubConfig(id);
  const intro = makePubArticleHtmlFromMarkdown(pubcfg.introduction.trim() || "my publications");
  return { pubcfg, intro };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { id } = await params;
  const { pubcfg, intro } = await getPubSiteData(id);

  const locale = pubcfg.locale || "mul";
  const siteTitle = pubcfg.siteName || intro.title || "Untitled";
  const siteDesc = intro.desc || siteTitle;
  const author = (pubcfg.author || "").trim();

  return {
    title: siteTitle,
    description: siteDesc,
    alternates: {
      canonical: `/pub/sites/${id}`,
    },
    openGraph: {
      title: siteTitle,
      description: siteDesc,
      type: "website",
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title: siteTitle,
      description: siteDesc,
      creator: author || undefined,
    },
    authors: author ? [{ name: author }] : undefined,
  };
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

export default async function PubSitePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { page: pageStr } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageStr ?? "1", 10) || 1);

  try {
    const { pubcfg, intro } = await getPubSiteData(id);
    const theme = Config.PUB_DESIGN_DARK_THEMES.includes(pubcfg.designTheme ?? "")
      ? pubcfg.designTheme
      : "default";
    const themeKind = Config.PUB_DESIGN_DARK_THEMES.includes(theme) ? "dark" : "light";

    const offset = (page - 1) * Config.PUB_POSTS_PAGE_SIZE;
    const posts = await listPubPostsByUser(id, {
      offset,
      limit: Config.PUB_POSTS_PAGE_SIZE + 1,
      order: "desc",
    });
    const hasPrev = page > 1;
    const hasNext = posts.length > Config.PUB_POSTS_PAGE_SIZE;
    const items = posts.slice(0, Config.PUB_POSTS_PAGE_SIZE);
    const baseHref = `/pub/sites/${id}`;
    const newerHref = `${baseHref}?page=${page - 1}`;
    const olderHref = `${baseHref}?page=${page + 1}`;

    const locale = pubcfg.locale || "mul";
    const siteIntroHtml = intro.html;
    const siteTitle = pubcfg.siteName || intro.title || "Untitled";

    return (
      <div className={`pub-page pub-theme-${theme} pub-theme-kind-${themeKind}`}>
        <PubServiceHeader
          showServiceHeader={pubcfg.showServiceHeader}
          redirectTo={baseHref}
          viewAsHref={`/users/${id}`}
        />
        <main className="site-container" lang={locale}>
          <div className="site-layout">
            <section className="site-main">
              <h1 className="pub-site-name">
                <a href={baseHref}>{siteTitle}</a>
              </h1>
              <section className="site-profile">
                <ArticleWithDecoration
                  lang={locale}
                  className="markdown-body site-intro"
                  html={siteIntroHtml}
                />
              </section>
              <section className="site-recent">
                {items.map((r) => {
                  const postHref = `/pub/${r.id}`;
                  const snippetHtml = makeHtmlFromJsonSnippet(r.snippet);
                  const publishedAtDate = new Date(r.publishedAt ?? "");
                  return (
                    <LinkDiv key={String(r.id)} href={postHref} className="link-div post-div">
                      <div className="date">{formatDateTime(publishedAtDate)}</div>
                      <ArticleWithDecoration
                        lang={r.locale || pubcfg.locale || locale}
                        className="markdown-body post-content-excerpt"
                        html={snippetHtml}
                      />
                    </LinkDiv>
                  );
                })}
              </section>
              <nav className="pub-pager" aria-label="Pagination">
                <div className="pager-row">
                  {hasPrev ? (
                    <a className="pager-btn" href={newerHref}>
                      ← Newer
                    </a>
                  ) : (
                    <span className="pager-btn disabled" aria-disabled="true">
                      ← Newer
                    </span>
                  )}
                  {hasNext ? (
                    <a className="pager-btn" href={olderHref}>
                      Older →
                    </a>
                  ) : (
                    <span className="pager-btn disabled" aria-disabled="true">
                      Older →
                    </span>
                  )}
                </div>
              </nav>
            </section>
          </div>
        </main>
      </div>
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load";
    return (
      <div className="pub-page pub-theme-default">
        <PubServiceHeader showServiceHeader={true} />
        <main className="pub-container">
          <h1>Error</h1>
          <pre>{msg}</pre>
        </main>
      </div>
    );
  }
}
