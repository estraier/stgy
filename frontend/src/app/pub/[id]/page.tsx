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
          {pubcfg.showSideProfile && (
            <aside className="pub-side-profile">
              <h2>{pubcfg.siteName}</h2>
              {pubcfg.author && <div>{pubcfg.author}</div>}
              {pubcfg.introduction && <pre>{pubcfg.introduction}</pre>}
            </aside>
          )}
          <article lang={post.locale || undefined} dangerouslySetInnerHTML={{ __html: articleHtml }} />
          {pubcfg.showSideRecent && (
            <aside className="pub-side-recent">
              <h2>Recent</h2>
              <ul>
                {recent.map((r) => {
                  const snippetHtml = convertHtmlMathInline(makeHtmlFromJsonSnippet(r.snippet));
                  return (
                    <li key={r.id}>
                      <a href={`/pub/${r.id}`} dangerouslySetInnerHTML={{ __html: snippetHtml }} />
                    </li>
                  );
                })}
              </ul>
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
