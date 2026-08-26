"use client";

import { useEffect, useRef } from "react";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

type Props = {
  measurementId: string;
  contentGroup: string;
  contentId: string;
  contentType: string;
};

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

export default function PubGoogleAnalyticsPageView({
  measurementId,
  contentGroup,
  contentId,
  contentType,
}: Props) {
  const lastSentPageViewKey = useRef<string | null>(null);

  useEffect(() => {
    const tagId = measurementId.trim();
    if (!tagId) return;

    const gtag = ensureGoogleTag();
    const pageLocation = window.location.href;
    const pageViewKey = [tagId, pageLocation, contentGroup, contentId, contentType].join("\n");

    // React Strict Mode may run effects twice in development. Suppress only an
    // immediate duplicate of the same page view; navigation away and back has a
    // different last key in between and is counted again.
    if (lastSentPageViewKey.current === pageViewKey) return;
    lastSentPageViewKey.current = pageViewKey;

    // Disable the automatic page_view so the one below can carry STGY's
    // content metadata without generating a duplicate page view.
    gtag("config", tagId, {
      send_page_view: false,
      content_group: contentGroup,
    });
    gtag("event", "page_view", {
      send_to: tagId,
      page_title: document.title,
      page_location: pageLocation,
      content_group: contentGroup,
      content_id: contentId,
      content_type: contentType,
    });
  }, [measurementId, contentGroup, contentId, contentType]);

  return null;
}
