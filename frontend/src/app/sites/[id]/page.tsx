import { cache } from "react";
import Link from "next/link";
import { Config } from "@/config";
import { HeadLangPatcher } from "@/components/HeadLangPatcher";
import PubServiceHeader from "@/components/PubServiceHeader";
import { listPubPostsByUser } from "@/api/posts";
import { getPubConfig } from "@/api/users";
import {
  makePubArticleHtmlFromMarkdown,
  makeHtmlFromJsonSnippet,
  makePubAttributesFromJsonSnippet,
} from "@/utils/article";
import LinkDiv from "@/components/LinkDiv";
import ArticleWithDecoration from "@/components/ArticleWithDecoration";
import { formatDateTime, makeAbsoluteUrl, convertForDirection } from "@/utils/format";
import PubImageBlockBinder from "@/components/PubImageBlockBinder";
import PubScrollAction from "@/components/PubScrollAction";
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
  const canonical = makeAbsoluteUrl(`/sites/${id}`);

  try {
    const { pubcfg, intro } = await getPubSiteData(id);
    const locale = pubcfg.locale || "und";
    const siteTitle = pubcfg.siteName || intro.title || "STGY Publications";
    const siteDesc = intro.desc || siteTitle;
    const author = (pubcfg.author || "").trim();
    const featuredImageUrl =
      intro.featured && typeof intro.featured === "string"
        ? makeAbsoluteUrl(intro.featured)
        : undefined;

    return {
      title: siteTitle,
      description: siteDesc,
      alternates: { canonical },
      openGraph: {
        title: siteTitle,
        description: siteDesc,
        type: "website",
        locale,
        images: featuredImageUrl ? [{ url: featuredImageUrl }] : undefined,
      },
      twitter: {
        card: "summary",
        title: siteTitle,
        description: siteDesc,
        creator: author || undefined,
        images: featuredImageUrl ? [featuredImageUrl] : undefined,
      },
      authors: author ? [{ name: author }] : undefined,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e ?? "");
    const is404 = /(^|\b)404(\b|$)/.test(msg) || /not\s*found/i.test(msg) || /no\s*such/i.test(msg);

    if (is404) {
      return {
        title: "Not found",
        description: "This publication site does not exist.",
        alternates: { canonical },
        robots: { index: false, follow: false },
        openGraph: { title: "Not found", type: "website" },
        twitter: { card: "summary", title: "Not found" },
      };
    }
    return {
      title: "Error",
      description: "Failed to load the publication site.",
      alternates: { canonical },
      robots: { index: false, follow: false },
    };
  }
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; design?: string; tab?: string; oldestFirst?: string }>;
};

export default async function PubSitePage({ params, searchParams }: Props) {
  const { id } = await params;
  const {
    page: pageStr,
    design: designRaw,
    tab: tabRaw,
    oldestFirst: oldestFirstRaw,
  } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageStr ?? "1", 10) || 1);
  const design = Array.isArray(designRaw) ? designRaw[0] : designRaw;
  const tab = Array.isArray(tabRaw) ? tabRaw[0] : tabRaw;
  const tabMode = tab === "plain" ? "plain" : "snippet";
  const oldestFirst = oldestFirstRaw === "1";

  try {
    const { pubcfg, intro } = await getPubSiteData(id);
    const baseTheme = Config.PUB_DESIGN_THEMES.includes(pubcfg.designTheme ?? "")
      ? pubcfg.designTheme
      : "default";
    const theme =
      typeof design === "string" && Config.PUB_DESIGN_THEMES.includes(design) ? design : baseTheme;
    const themeDir = Config.PUB_DESIGN_VERTICAL_THEMES.includes(theme) ? "vert" : "norm";
    const themeTone = Config.PUB_DESIGN_DARK_THEMES.includes(theme) ? "dark" : "light";
    const order = oldestFirst ? "asc" : "desc";
    const page_size =
      tabMode === "plain" ? Config.PUB_POSTS_PLAIN_PAGE_SIZE : Config.PUB_POSTS_RICH_PAGE_SIZE;
    const offset = (page - 1) * page_size;
    const posts = await listPubPostsByUser(id, {
      offset,
      limit: page_size + 1,
      order,
    });
    const hasPrev = page > 1;
    const hasNext = posts.length > page_size;
    const items = posts.slice(0, page_size);
    const siteRoot = `/sites/${id}`;
    const baseHref = design ? `${siteRoot}?design=${encodeURIComponent(design)}` : siteRoot;
    const buildPageHref = (p: number) => {
      const qs = new URLSearchParams();
      qs.set("page", String(p));
      if (design) qs.set("design", String(design));
      if (tabMode === "plain") qs.set("tab", "plain");
      if (oldestFirst) qs.set("oldestFirst", "1");
      const query = qs.toString();
      return query ? `${siteRoot}?${query}` : siteRoot;
    };
    const newerHref = buildPageHref(page - 1);
    const olderHref = buildPageHref(page + 1);

    const buildTabHref = (mode: "snippet" | "plain") => {
      const qs = new URLSearchParams();
      qs.set("page", "1");
      if (design) qs.set("design", String(design));
      if (mode === "plain") qs.set("tab", "plain");
      const query = qs.toString();
      return query ? `${siteRoot}?${query}` : siteRoot;
    };

    const snippetHref = buildTabHref("snippet");
    const listHref = buildTabHref("plain");

    const buildOldestFirstHref = (on: boolean) => {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      if (design) qs.set("design", String(design));
      if (tabMode === "plain") qs.set("tab", "plain");
      if (on) qs.set("oldestFirst", "1");
      const query = qs.toString();
      return query ? `${siteRoot}?${query}` : siteRoot;
    };

    const oldestFirstHref = buildOldestFirstHref(!oldestFirst);

    const locale = pubcfg.locale || "und";
    const siteIntroHtml = intro.html;
    const siteTitle = pubcfg.siteName || intro.title || "STGY Publications";

    return (
      <div
        className={`pub-page pub-theme-${theme} pub-theme-dir-${themeDir} pub-theme-tone-${themeTone}`}
        data-page={page}
      >
        <HeadLangPatcher lang={locale} />
        <PubServiceHeader
          showServiceHeader={pubcfg.showServiceHeader}
          redirectTo={baseHref}
          viewAsHref={`/users/${id}`}
        />
        <main className="site-container" lang={locale}>
          <div className="site-layout">
            <section className="site-main">
              <div className="pub-site-name-region">
                <h1 className="pub-site-name">
                  <a href={baseHref}>{siteTitle}</a>
                </h1>
                {pubcfg.subtitle?.trim() && (
                  <div className="pub-subtitle">{pubcfg.subtitle.trim()}</div>
                )}
              </div>
              <section className="site-profile">
                <ArticleWithDecoration
                  lang={locale}
                  className="markdown-body site-intro"
                  html={siteIntroHtml}
                />
              </section>
              <nav className="site-posts-controls">
                <div className="posts-controls-row">
                  <span className="posts-label">
                    {convertForDirection("Posts:", themeDir)}
                  </span>
                  <div className="posts-tabs">
                    <Link
                      className={`posts-tab${tabMode === "snippet" ? " active" : ""}`}
                      href={snippetHref}
                    >
                      {convertForDirection("Rich", themeDir)}
                    </Link>
                    <Link
                      className={`posts-tab${tabMode === "plain" ? " active" : ""}`}
                      href={listHref}
                    >
                      {convertForDirection("Plain", themeDir)}
                    </Link>
                  </div>
                  <div className="posts-order">
                    <Link href={oldestFirstHref} className="oldest-first-label">
                      <input type="checkbox" checked={oldestFirst} readOnly />
                      <span>
                        {convertForDirection("Oldest", themeDir)}
                      </span>
                    </Link>
                  </div>
                </div>
              </nav>
              <section className="site-recent">
                {tabMode === "plain" ? (
                  <ul className="pub-post-list">
                    {items.map((r) => {
                      const postHref = `/pub/${r.id}${
                        design ? `?design=${encodeURIComponent(design)}` : ""
                      }`;
                      const publishedAtDate = new Date(r.publishedAt ?? "");
                      const attrs = makePubAttributesFromJsonSnippet(r.snippet);
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
                            {attrs.metadata.author && (
                              <em className="author">{attrs.metadata.author}</em>
                            )}
                            {attrs.desc}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  items.map((r, idx) => {
                    const postHref = `/pub/${r.id}${
                      design ? `?design=${encodeURIComponent(design)}` : ""
                    }`;
                    const snippetHtml = makeHtmlFromJsonSnippet(r.snippet, `p${idx + 1}-h`);
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
                          lang={r.locale || pubcfg.locale || locale}
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
                    <Link className="pager-btn" href={newerHref}>
                      {convertForDirection("← Newer", themeDir)}
                    </Link>
                  ) : (
                    <span className="pager-btn disabled" aria-disabled="true">
                      {convertForDirection("← Newer", themeDir)}
                    </span>
                  )}
                  {hasNext ? (
                    <Link className="pager-btn" href={olderHref}>
                      {convertForDirection("Older →", themeDir)}
                    </Link>
                  ) : (
                    <span className="pager-btn disabled" aria-disabled="true">
                      {convertForDirection("Older →", themeDir)}
                    </span>
                  )}
                </div>
              </nav>
            </section>
          </div>
        </main>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
var RID="lastPubPostId";var RPG="lastPubPostPage";
if(typeof window==="undefined")return;
if(!window.__stgyPubSiteBound){
  window.__stgyPubSiteBound=true;
  document.body.addEventListener("mousedown",function(e){
    var t=e.target;if(!t||!t.closest)return;
    var n=t.closest(".post-div");
    if(n){
      var id=n.getAttribute("data-restore-id");
      var pg=n.getAttribute("data-restore-page");
      if(id&&pg){
        try{
          var st=window.history.state||{};
          window.history.replaceState(Object.assign({},st,((o)=>{o[RID]=id;o[RPG]=pg;return o;})({})), "");
        }catch(_){}
      }
    }
  },true);
}
try{
  var st2=window.history.state||{};
  var pid=typeof st2[RID]==="string"?st2[RID]:null;
  var pgRaw=st2[RPG];
  var pg=typeof pgRaw==="number"?pgRaw:(typeof pgRaw==="string"?parseInt(pgRaw,10):NaN);
  var currentPage=${page};
  if(pid && !Number.isNaN(pg) && Number(pg)===Number(currentPage)){
    var tryScroll=function(){
      var el=document.getElementById("pubpost-"+pid);
      if(el){
        var rect=el.getBoundingClientRect();
        var absTop=window.scrollY+rect.top;
        var desired=Math.max(0,absTop-window.innerHeight*0.4);
        window.scrollTo({top:desired});
        try{
          var st3=window.history.state||{};
          var rest={};for(var k in st3){if(k!==RID && k!==RPG){rest[k]=st3[k];}}
          window.history.replaceState(rest,"");
        }catch(__){}
        return true;
      }
      return false;
    };
    if(!tryScroll()){
      var i=0;var max=10;
      var raf=function(){if(tryScroll())return;i++;if(i<max)requestAnimationFrame(raf);};
      requestAnimationFrame(raf);
    }
  }
}catch(___){}
})();`,
          }}
        />
        <PubImageBlockBinder />
        <PubScrollAction selectors={[".site-container"]} />
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
              <p>This publication site doesn’t exist or is private.</p>
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
