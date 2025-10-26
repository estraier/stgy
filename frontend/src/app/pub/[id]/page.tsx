import PubServiceHeader from "@/components/PubServiceHeader";
import { getPubPost, listPubPostsByUser } from "@/api/posts";
import { getSessionInfo } from "@/api/authSsr";
import { getPubConfig } from "@/api/users";
import { makeArticleHtmlFromMarkdown, makeHtmlFromJsonSnippet } from "@/utils/article";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";

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
      recent = await listPubPostsByUser(post.ownedBy, { offset: 0, limit: 10, order: "desc" });
    }
    return (
      <>
        <link rel="stylesheet" href={`/pub-${theme}.css`} />
        <PubServiceHeader
          showServiceHeader={pubcfg.showServiceHeader}
          session={session ?? undefined}
          redirectTo={`/posts/${post.id}`}
          viewAsHref={`/posts/${post.id}`}
        />
        <main className="pub-container">
          <article
            lang={post.locale || undefined}
            className="markdown-body post-content"
            dangerouslySetInnerHTML={{ __html: articleHtml }}
          />
          {(pubcfg.showSideProfile || pubcfg.showSideRecent) && (
            <aside className="pub-sidebar">
              {pubcfg.showSideProfile && (
                <section className="pub-side-profile">
                  <h2>Profile</h2>
                  <div className="profile-column">
                    <div className="site-name">{pubcfg.siteName.trim() || "Untitled"}</div>
                    <div className="author">{pubcfg.author.trim() || "anonymous"}</div>
                    <p className="introduction">{pubcfg.introduction.trim() || "my publications"}</p>
                  </div>
                </section>
              )}
              {pubcfg.showSideRecent && (
                <section className="pub-side-recent">
                  <h2>Recent posts</h2>
                  <ul>
                    {recent.map((r) => {
                      const snippetHtml = convertHtmlMathInline(makeHtmlFromJsonSnippet(r.snippet));
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
        </main>
      </>
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load";
    return (
      <>
        <link rel="stylesheet" href="/pub-default.css" />
        <PubServiceHeader showServiceHeader={true} session={session ?? undefined} />
        <main className="pub-container">
          <h1>Error</h1>
          <pre>{msg}</pre>
        </main>
      </>
    );
  }
}
