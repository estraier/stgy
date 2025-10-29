import { Config } from "@/config";
import PubServiceHeader from "@/components/PubServiceHeader";
import { getPubPost, listPubPostsByUser } from "@/api/posts";
import { getPubConfig } from "@/api/users";
import {
  makeArticleHtmlFromMarkdown,
  makeHtmlFromJsonSnippet,
  makeSnippetHtmlFromMarkdown,
} from "@/utils/article";
import LinkDiv from "@/components/LinkDiv";
import ArticleWithDecoration from "@/components/ArticleWithDecoration";
import { formatDateTime } from "@/utils/format";

type Props = { params: Promise<{ id: string }> };

export default async function PubPostPage({ params }: Props) {
  const { id } = await params;
  try {
    const post = await getPubPost(id);
    const pubcfg = await getPubConfig(post.ownedBy);
    const theme = Config.PUB_DESIGN_DARK_THEMES.includes(pubcfg.designTheme ?? "")
      ? pubcfg.designTheme
      : "default";
    const themeKind = Config.PUB_DESIGN_DARK_THEMES.includes(theme) ? "dark" : "light";
    const articleHtml =
      post.content && post.content.length > 0
        ? makeArticleHtmlFromMarkdown(post.content)
        : makeHtmlFromJsonSnippet(post.snippet);
    const siteIntroHtml = makeSnippetHtmlFromMarkdown(
      pubcfg.introduction.trim() || "my publications",
    );
    let recent: Awaited<ReturnType<typeof listPubPostsByUser>> = [];
    if (pubcfg.showSideRecent) {
      recent = await listPubPostsByUser(post.ownedBy, { offset: 0, limit: 5, order: "desc" });
    }
    const siteHref = `/pub/sites/${post.ownedBy}`;
    return (
      <div className={`pub-page pub-theme-${theme} pub-theme-kind-${themeKind}`}>
        <PubServiceHeader
          showServiceHeader={pubcfg.showServiceHeader}
          redirectTo={`/posts/${post.id}`}
          viewAsHref={`/posts/${post.id}`}
        />
        <main className="pub-container">
          <div className="pub-layout">
            <section className="pub-main">
              {pubcfg.showSiteName && (
                <h1 className="pub-site-name">
                  <a href={siteHref}>{pubcfg.siteName.trim() || "Untitled"}</a>
                </h1>
              )}
              <div className="date">{formatDateTime(new Date(post.publishedAt ?? ""))}</div>
              <ArticleWithDecoration
                lang={post.locale || undefined}
                className="markdown-body post-content"
                html={articleHtml}
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
            {(pubcfg.showSideProfile || pubcfg.showSideRecent) && (
              <aside className="pub-sidebar">
                {pubcfg.showSideProfile && (
                  <section className="pub-side-profile">
                    <h2 className="side-header">Profile</h2>
                    <LinkDiv href={siteHref} className="link-div">
                      <ArticleWithDecoration
                        className="markdown-body post-content-excerpt site-intro"
                        html={siteIntroHtml}
                      />
                    </LinkDiv>
                  </section>
                )}
                {pubcfg.showSideRecent && (
                  <section className="pub-side-recent">
                    <h2 className="side-header">Recent posts</h2>
                    {recent.map((r) => {
                      const postHref = `/pub/${r.id}`;
                      const snippetHtml = makeHtmlFromJsonSnippet(r.snippet);
                      return (
                        <LinkDiv key={String(r.id)} href={postHref} className="link-div">
                          <ArticleWithDecoration
                            lang={r.locale || undefined}
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
