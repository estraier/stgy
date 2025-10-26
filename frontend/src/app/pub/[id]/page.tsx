import PubServiceHeader from "@/components/PubServiceHeader";
import { getPubPost, listPubPostsByUser } from "@/api/posts";
import { getSessionInfo } from "@/api/authSsr";
import { getPubConfig } from "@/api/users";
import { makeArticleHtmlFromMarkdown, makeHtmlFromJsonSnippet } from "@/utils/article";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";
import { formatDateTime } from "@/utils/format";

type Props = { params: Promise<{ id: string }> };

export default async function PubPostPage({ params }: Props) {
  const { id } = await params;
  const session = await getSessionInfo();
  try {
    const post = await getPubPost(id);
    const pubcfg = await getPubConfig(post.ownedBy);
    const theme = pubcfg.designTheme?.trim() ? pubcfg.designTheme : "default";
    const articleHtml = convertHtmlMathInline(
      post.content && post.content.length > 0
        ? makeArticleHtmlFromMarkdown(post.content)
        : makeHtmlFromJsonSnippet(post.snippet),
    );
    let recent: Awaited<ReturnType<typeof listPubPostsByUser>> = [];
    if (pubcfg.showSideRecent) {
      recent = await listPubPostsByUser(post.ownedBy, { offset: 0, limit: 5, order: "desc" });
    }
    const siteHref = `/pub/sites/${post.ownedBy}`;
    return (
      <div className={`pub-page pub-theme-${theme}`}>
        <PubServiceHeader
          showServiceHeader={pubcfg.showServiceHeader}
          session={session ?? undefined}
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
              <div className="date">{formatDateTime(new Date(post.publishedAt))}</div>
              <article
                lang={post.locale || undefined}
                className="markdown-body post-content"
                dangerouslySetInnerHTML={{ __html: articleHtml }}
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
                  <a href={siteHref} className="pub-site-link">
                    <section className="pub-side-profile">
                      <h2>Profile</h2>
                      <div className="profile-column">
                        {!pubcfg.showSiteName && (
                          <div className="site-name">{pubcfg.siteName.trim() || "Untitled"}</div>
                        )}
                        <div className="author">{pubcfg.author.trim() || "anonymous"}</div>
                        <p className="introduction">
                          {pubcfg.introduction.trim() || "my publications"}
                        </p>
                      </div>
                    </section>
                  </a>
                )}
                {pubcfg.showSideRecent && (
                  <section className="pub-side-recent">
                    <h2>Recent posts</h2>
                    <ul>
                      {recent.map((r) => {
                        let snippetHtml = convertHtmlMathInline(makeHtmlFromJsonSnippet(r.snippet));
                        snippetHtml = snippetHtml
                          .replace(/<a\b[^>]*>/gi, "")
                          .replace(/<\/a>/gi, "");
                        return (
                          <li key={r.id}>
                            <a href={`/pub/${r.id}`}>
                              <article
                                lang={r.locale || undefined}
                                className="markdown-body post-content-excerpt"
                                dangerouslySetInnerHTML={{ __html: snippetHtml }}
                              />
                            </a>
                          </li>
                        );
                      })}
                    </ul>
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
        <PubServiceHeader showServiceHeader={true} session={session ?? undefined} />
        <main className="pub-container">
          <h1>Error</h1>
          <pre>{msg}</pre>
        </main>
      </div>
    );
  }
}
