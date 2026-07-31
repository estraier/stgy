"use client";

import { useCallback, useRef } from "react";
import {
  createLinkSnippetHydrator,
  type LinkSnippetHydrator,
} from "@/utils/linkSnippetHydration";

export function useLinkSnippetHydrator(): LinkSnippetHydrator {
  const hydratorRef = useRef<LinkSnippetHydrator | null>(null);
  if (hydratorRef.current === null) {
    hydratorRef.current = createLinkSnippetHydrator();
  }
  return useCallback((root: HTMLElement) => {
    hydratorRef.current?.(root);
  }, []);
}
