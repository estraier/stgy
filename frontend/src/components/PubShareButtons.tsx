"use client";

import { useEffect, useMemo, useRef } from "react";
import { FaFacebookF, FaXTwitter } from "react-icons/fa6";
import { SiLine } from "react-icons/si";

type Props = {
  enabled: readonly string[];
  url: string;
  title: string;
  locale?: string;
  vertical?: boolean;
};

type ShareWidgetWindow = Window & {
  twttr?: {
    widgets?: {
      load?: (element?: HTMLElement) => void;
    };
  };
  FB?: {
    XFBML?: {
      parse?: (element?: HTMLElement) => void;
    };
  };
  Hatena?: {
    Star?: {
      VERSION?: number;
    };
  };
};

const X_WIDGETS_SRC = "https://platform.twitter.com/widgets.js";
const FACEBOOK_SDK_MARKER = "stgy-facebook-sdk";
const HATENA_BOOKMARK_WIDGETS_SRC = "https://b.st-hatena.com/js/bookmark_button.js";
const HATENA_STAR_WIDGET_SRC = "https://s.hatena.ne.jp/js/widget/star.js";
const HATENA_STAR_WIDGET_MARKER = "stgy-hatena-star-widget";

let hatenaBookmarkWidgetsLoading = false;

function loadHatenaBookmarkWidgets(): void {
  if (hatenaBookmarkWidgetsLoading) return;
  hatenaBookmarkWidgetsLoading = true;

  queueMicrotask(() => {
    const script = document.createElement("script");
    script.src = HATENA_BOOKMARK_WIDGETS_SRC;
    script.async = true;
    script.charset = "utf-8";
    const done = () => {
      hatenaBookmarkWidgetsLoading = false;
      script.remove();
    };
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", done, { once: true });
    document.head.appendChild(script);
  });
}

function makeHatenaEntryUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const securePrefix = url.protocol === "https:" ? "s/" : "";
    return `https://b.hatena.ne.jp/entry/${securePrefix}${url.host}${url.pathname}${url.search}`;
  } catch {
    return "https://b.hatena.ne.jp/entry/";
  }
}

export default function PubShareButtons({ enabled, url, title, locale, vertical = false }: Props) {
  const rootRef = useRef<HTMLElement | null>(null);
  const enabledSet = useMemo(() => new Set(enabled), [enabled]);
  const showX = enabledSet.has("x");
  const showFacebook = enabledSet.has("facebook");
  const showLine = enabledSet.has("line");
  const showHatena = enabledSet.has("hatena");
  const showAny = showX || showFacebook || showLine || showHatena;
  const widgetLang = locale?.toLowerCase().startsWith("ja") ? "ja" : "en";

  useEffect(() => {
    if (!showHatena || !rootRef.current) return;

    // Hatena Blog currently uses the Star v2 widget.  It scans elements marked
    // with data-hatena-star-container and reads the URL/title from data
    // attributes.  Load it only after this Client Component has hydrated so
    // the widget cannot mutate the server HTML before React hydration.
    const widgetWindow = window as ShareWidgetWindow;
    widgetWindow.Hatena ??= {};
    if (!widgetWindow.Hatena.Star) {
      widgetWindow.Hatena.Star = { VERSION: 2 };
    } else {
      widgetWindow.Hatena.Star.VERSION = 2;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-${HATENA_STAR_WIDGET_MARKER}="true"]`,
    );
    if (existing) return;

    const script = document.createElement("script");
    script.src = HATENA_STAR_WIDGET_SRC;
    script.async = true;
    script.setAttribute(`data-${HATENA_STAR_WIDGET_MARKER}`, "true");
    document.head.appendChild(script);
  }, [showHatena]);

  useEffect(() => {
    if (vertical || !showX || !rootRef.current) return;

    const render = () => {
      const twttr = (window as ShareWidgetWindow).twttr;
      twttr?.widgets?.load?.(rootRef.current ?? undefined);
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${X_WIDGETS_SRC}"]`,
    );
    if (existing) {
      if ((window as ShareWidgetWindow).twttr?.widgets?.load) render();
      else existing.addEventListener("load", render, { once: true });
      return () => existing.removeEventListener("load", render);
    }

    const script = document.createElement("script");
    script.src = X_WIDGETS_SRC;
    script.async = true;
    script.charset = "utf-8";
    script.addEventListener("load", render, { once: true });
    document.head.appendChild(script);
    return () => script.removeEventListener("load", render);
  }, [showX, url, title, widgetLang, vertical]);

  useEffect(() => {
    if (vertical || !showFacebook || !rootRef.current) return;

    const render = () => {
      (window as ShareWidgetWindow).FB?.XFBML?.parse?.(
        rootRef.current ?? undefined,
      );
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-${FACEBOOK_SDK_MARKER}="true"]`,
    );
    if (existing) {
      if ((window as ShareWidgetWindow).FB?.XFBML?.parse) render();
      else existing.addEventListener("load", render, { once: true });
      return () => existing.removeEventListener("load", render);
    }

    if (!document.getElementById("fb-root")) {
      const fbRoot = document.createElement("div");
      fbRoot.id = "fb-root";
      document.body.prepend(fbRoot);
    }

    const facebookLocale = widgetLang === "ja" ? "ja_JP" : "en_US";
    const script = document.createElement("script");
    script.src = `https://connect.facebook.net/${facebookLocale}/sdk.js#xfbml=1&version=v26.0`;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.setAttribute(`data-${FACEBOOK_SDK_MARKER}`, "true");
    script.addEventListener("load", render, { once: true });
    document.head.appendChild(script);
    return () => script.removeEventListener("load", render);
  }, [showFacebook, url, widgetLang, vertical]);

  useEffect(() => {
    if (!showHatena || !rootRef.current) return;

    // The official script scans the whole document. Multiple share-button rows can
    // mount together on /sites/[id], so coalesce them into one scan. A later
    // client-side navigation can still trigger another scan after this one ends.
    loadHatenaBookmarkWidgets();
  }, [showHatena, url, title, widgetLang]);

  useEffect(() => {
    if (!vertical || !showHatena || !rootRef.current) return;

    const wrapper = rootRef.current.querySelector<HTMLElement>(
      ".pub-share-compact-star",
    );
    const starContainer = wrapper?.querySelector<HTMLElement>(
      ".pub-hatena-star-container",
    );
    if (!wrapper || !starContainer) return;

    let frame: number | null = null;
    const updateSize = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const contentWidth = Math.max(22, Math.ceil(starContainer.scrollWidth));
        wrapper.style.setProperty(
          "--pub-hatena-star-length",
          `${contentWidth + 2}px`,
        );
      });
    };

    const mutationObserver = new MutationObserver(updateSize);
    mutationObserver.observe(starContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(starContainer);
    updateSize();

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [showHatena, url, vertical]);

  if (!showAny) return null;

  if (vertical) {
    return (
      <nav
        ref={rootRef}
        className="pub-share-buttons pub-share-buttons-vertical"
        aria-label="Share"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {showX && (
          <a
            href={`https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`}
            className="pub-share-compact-button pub-share-compact-x"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={widgetLang === "ja" ? "Xで共有" : "Share on X"}
            title={widgetLang === "ja" ? "Xで共有" : "Share on X"}
          >
            <FaXTwitter aria-hidden="true" />
          </a>
        )}
        {showFacebook && (
          <a
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
            className="pub-share-compact-button pub-share-compact-facebook"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={widgetLang === "ja" ? "Facebookで共有" : "Share on Facebook"}
            title={widgetLang === "ja" ? "Facebookで共有" : "Share on Facebook"}
          >
            <FaFacebookF aria-hidden="true" />
          </a>
        )}
        {showLine && (
          <a
            href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`}
            className="pub-share-compact-button pub-share-compact-line"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={widgetLang === "ja" ? "LINEで送る" : "Share on LINE"}
            title={widgetLang === "ja" ? "LINEで送る" : "Share on LINE"}
          >
            <SiLine aria-hidden="true" />
          </a>
        )}
        {showHatena && (
          <>
            <a
              href={makeHatenaEntryUrl(url)}
              className="hatena-bookmark-button pub-share-compact-button pub-share-compact-hatena"
              data-hatena-bookmark-title={title}
              data-hatena-bookmark-layout="simple"
              data-hatena-bookmark-lang={widgetLang}
              title="このエントリーをはてなブックマークに追加"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://b.st-hatena.com/images/v4/public/entry-button/button-only@2x.png"
                alt="このエントリーをはてなブックマークに追加"
                width="20"
                height="20"
                style={{ border: "none" }}
              />
            </a>
            <span className="pub-share-compact-star" title="Hatena Star">
              <span
                key={`hatena-star:${url}`}
                className="hatena-star-container pub-hatena-star-container"
                data-hatena-star-container=""
                data-hatena-star-url={url}
                data-hatena-star-title={title}
                data-hatena-star-variant="profile-icon"
                data-hatena-star-profile-url-template="https://blog.hatena.ne.jp/{username}/"
              />
            </span>
          </>
        )}
      </nav>
    );
  }

  return (
    <nav
      ref={rootRef}
      className="pub-share-buttons pub-share-buttons-horizontal"
      aria-label="Share"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {showX && (
        <span className="pub-share-widget pub-share-x">
          <a
            href={`https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`}
            className="twitter-share-button"
            data-url={url}
            data-text={title}
            data-lang={widgetLang}
            data-dnt="true"
          >
            Post
          </a>
        </span>
      )}
      {showFacebook && (
        <span className="pub-share-widget pub-share-facebook">
          <div
            key={`facebook:${url}`}
            className="fb-share-button"
            data-href={url}
            data-layout="button_count"
            data-size="small"
          >
            <a
              target="_blank"
              rel="noopener noreferrer"
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&src=sdkpreparse`}
              className="fb-xfbml-parse-ignore"
            >
              Share
            </a>
          </div>
        </span>
      )}
      {showLine && (
        <span className="pub-share-widget pub-share-line">
          <a
            href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`}
            className="pub-line-share-button"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={widgetLang === "ja" ? "LINEで送る" : "Share on LINE"}
            title={widgetLang === "ja" ? "LINEで送る" : "Share on LINE"}
          >
            LINE
          </a>
        </span>
      )}
      {showHatena && (
        <div className="pub-share-widget pub-share-hatena">
          <a
            href={makeHatenaEntryUrl(url)}
            className="hatena-bookmark-button"
            data-hatena-bookmark-title={title}
            data-hatena-bookmark-layout="basic-label-counter"
            data-hatena-bookmark-lang={widgetLang}
            title="このエントリーをはてなブックマークに追加"
          >
            {/* Hatena Bookmark provides this image as part of its official widget. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://b.st-hatena.com/images/v4/public/entry-button/button-only@2x.png"
              alt="このエントリーをはてなブックマークに追加"
              width="20"
              height="20"
              style={{ border: "none" }}
            />
          </a>
          <span
            key={`hatena-star:${url}`}
            className="hatena-star-container pub-hatena-star-container"
            data-hatena-star-container=""
            data-hatena-star-url={url}
            data-hatena-star-title={title}
            data-hatena-star-variant="profile-icon"
            data-hatena-star-profile-url-template="https://blog.hatena.ne.jp/{username}/"
          />
        </div>
      )}
    </nav>
  );
}
