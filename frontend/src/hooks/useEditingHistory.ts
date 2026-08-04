"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cleanupEditingHistory,
  hashEditingHistoryContent,
  saveEditingHistorySnapshot,
  type EditingHistoryTarget,
} from "@/utils/editingHistory";

const SAVE_INTERVAL_MS = 5 * 60 * 1000;

type EditingHistorySession = {
  ownerUserId: string;
  target: EditingHistoryTarget;
  openedAt: number;
  initialHashPromise: Promise<string>;
  lastSavedAt: number | null;
  lastSavedHash: string | null;
  finished: boolean;
  saving: boolean;
  timer: number | null;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Local editing history could not be saved.";
}

export function useEditingHistory(params: {
  ownerUserId?: string;
  target?: EditingHistoryTarget;
  content: string;
}) {
  const { ownerUserId, target, content } = params;
  const contentRef = useRef(content);
  contentRef.current = content;
  const sessionRef = useRef<EditingHistorySession | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const [error, setError] = useState<string | null>(null);

  const reportError = useCallback((caught: unknown) => {
    if (mountedRef.current) setError(errorMessage(caught));
  }, []);

  const persist = useCallback(
    async (session: EditingHistorySession, value: string, report = true): Promise<boolean> => {
      if (session.finished) return false;
      try {
        const currentHash = await hashEditingHistoryContent(value);
        const comparisonHash = session.lastSavedHash ?? (await session.initialHashPromise);
        if (currentHash === comparisonHash) return false;
        const snapshot = await saveEditingHistorySnapshot({
          ownerUserId: session.ownerUserId,
          target: session.target,
          content: value,
          contentHash: currentHash,
          kind: "periodic",
        });
        if (!session.finished) {
          session.lastSavedAt = snapshot.timestamp;
          session.lastSavedHash = currentHash;
        }
        if (mountedRef.current) setError(null);
        return true;
      } catch (caught) {
        if (report) reportError(caught);
        throw caught;
      }
    },
    [reportError],
  );

  const enqueuePersist = useCallback(
    (session: EditingHistorySession, value: string, report = true): Promise<boolean> => {
      if (session.saving) {
        return saveQueueRef.current.then(() => {
          if (session.finished) return false;
          return enqueuePersist(session, value, report);
        });
      }
      session.saving = true;
      let result = false;
      const task = saveQueueRef.current.then(async () => {
        try {
          result = await persist(session, value, report);
        } finally {
          session.saving = false;
        }
      });
      saveQueueRef.current = task.catch(() => undefined);
      return task.then(() => result);
    },
    [persist],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session || session.finished) return false;
    if (session.timer !== null) {
      window.clearTimeout(session.timer);
      session.timer = null;
    }
    await saveQueueRef.current;
    if (session.finished) return false;
    return enqueuePersist(session, contentRef.current, true);
  }, [enqueuePersist]);

  const finish = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.finished = true;
    if (session.timer !== null) {
      window.clearTimeout(session.timer);
      session.timer = null;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ownerUserId || !target) return;

    const session: EditingHistorySession = {
      ownerUserId,
      target,
      openedAt: Date.now(),
      initialHashPromise: hashEditingHistoryContent(contentRef.current),
      lastSavedAt: null,
      lastSavedHash: null,
      finished: false,
      saving: false,
      timer: null,
    };
    sessionRef.current = session;
    void cleanupEditingHistory().catch(reportError);

    return () => {
      if (session.timer !== null) window.clearTimeout(session.timer);
      if (sessionRef.current === session) sessionRef.current = null;
      if (!session.finished) {
        const value = contentRef.current;
        void enqueuePersist(session, value, false).catch(() => undefined);
      }
    };
  }, [ownerUserId, target?.type, target?.id, enqueuePersist, reportError]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || session.finished || session.saving) return;
    if (session.timer !== null) window.clearTimeout(session.timer);
    const eligibleAt = (session.lastSavedAt ?? session.openedAt) + SAVE_INTERVAL_MS;
    const delay = Math.max(0, eligibleAt - Date.now());
    session.timer = window.setTimeout(() => {
      session.timer = null;
      if (session.finished || session.saving) return;
      const value = contentRef.current;
      void enqueuePersist(session, value, true)
        .then((saved) => {
          if (!saved || session.finished || contentRef.current === value) return;
          const nextDelay = Math.max(
            0,
            (session.lastSavedAt ?? Date.now()) + SAVE_INTERVAL_MS - Date.now(),
          );
          session.timer = window.setTimeout(() => {
            session.timer = null;
            if (!session.finished && !session.saving) {
              void enqueuePersist(session, contentRef.current, true).catch(() => undefined);
            }
          }, nextDelay);
        })
        .catch(() => {
          if (session.finished || session.timer !== null) return;
          session.timer = window.setTimeout(() => {
            session.timer = null;
            if (!session.finished && !session.saving) {
              void enqueuePersist(session, contentRef.current, true).catch(() => undefined);
            }
          }, SAVE_INTERVAL_MS);
        });
    }, delay);
    return () => {
      if (session.timer !== null) {
        window.clearTimeout(session.timer);
        session.timer = null;
      }
    };
  }, [content, ownerUserId, target?.type, target?.id, enqueuePersist]);

  useEffect(() => {
    const saveForDeparture = () => {
      const session = sessionRef.current;
      if (!session || session.finished) return;
      if (session.timer !== null) {
        window.clearTimeout(session.timer);
        session.timer = null;
      }
      void saveQueueRef.current
        .then(() => {
          if (!session.finished) {
            return enqueuePersist(session, contentRef.current, false);
          }
        })
        .catch(() => undefined);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveForDeparture();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", saveForDeparture);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", saveForDeparture);
    };
  }, [enqueuePersist]);

  return { flush, finish, error, clearError };
}
