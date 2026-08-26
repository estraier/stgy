"use client";

import { useEffect, useRef } from "react";
import { useServerInsertedHTML } from "next/navigation";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    __stgyGaCfg?: Map<string, string>;
  }
}

type Props = {
  measurementId: string;
  contentGroup: string;
  contentId: string;
  contentType: string;
  pageViewKey?: string;
};

function inlineString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function googleTagInitScript(measurementId: string, contentGroup: string): string {
  const tagId = inlineString(measurementId);
  const group = inlineString(contentGroup);
  return `window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};window.gtag("js",new Date());window.gtag("config",${tagId},{send_page_view:false,content_group:${group}});window.__stgyGaCfg=window.__stgyGaCfg||new Map;window.__stgyGaCfg.set(${tagId},${group});`;
}

function ensureGoogleTag(): Gtag {
  window.dataLayer ??= [];
  if (!window.gtag) {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
    window.gtag("js", new Date());
  }
  return window.gtag;
}

function ensureGoogleTagConfigured(
  gtag: Gtag,
  tagId: string,
  contentGroup: string,
): void {
  const configuredGroups = (window.__stgyGaCfg ??= new Map<string, string>());
  if (configuredGroups.get(tagId) === contentGroup) return;

  gtag("config", tagId, {
    send_page_view: false,
    content_group: contentGroup,
  });
  configuredGroups.set(tagId, contentGroup);
}

export default function PubGoogleAnalyticsPageView({
  measurementId,
  contentGroup,
  contentId,
  contentType,
  pageViewKey,
}: Props) {
  const serverInitInserted = useRef(false);
  const lastSentPageViewKey = useRef<string | null>(null);

  useServerInsertedHTML(() => {
    if (serverInitInserted.current) return null;
    serverInitInserted.current = true;
    return (
      <script
        dangerouslySetInnerHTML={{
          __html: googleTagInitScript(measurementId, contentGroup),
        }}
      />
    );
  });

  useEffect(() => {
    const tagId = measurementId.trim();
    if (!tagId) return;

    const gtag = ensureGoogleTag();
    ensureGoogleTagConfigured(gtag, tagId, contentGroup);

    const pageLocation = window.location.href;
    const dedupeKey = [
      tagId,
      pageLocation,
      contentGroup,
      contentId,
      contentType,
      pageViewKey ?? "",
    ].join("\n");

    // React Strict Mode may run effects twice in development. Suppress only an
    // immediate duplicate of the same page view; navigation away and back has a
    // different last key in between and is counted again.
    if (lastSentPageViewKey.current === dedupeKey) return;
    lastSentPageViewKey.current = dedupeKey;

    gtag("event", "page_view", {
      send_to: tagId,
      page_title: document.title,
      page_location: pageLocation,
      content_group: contentGroup,
      content_id: contentId,
      content_type: contentType,
    });
  }, [measurementId, contentGroup, contentId, contentType, pageViewKey]);

  return null;
}
