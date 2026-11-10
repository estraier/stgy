import { purgeExpiredCanonicalSessions } from "./canonical-source";
import { purgeExpiredStackScratchSessions } from "./scratch";

export const LSS_CACHE_RETENTION_MS = 3_600_000;
export const LSS_CACHE_CLEANUP_INTERVAL_MS = 1_800_000;
const LAST_CLEANUP_KEY = "stgy:lss:temporary-cache-last-cleanup-v2";
const CLEANUP_LOCK_NAME = "stgy:lss:temporary-cache-cleanup-v2";

let lastCleanupInMemory = 0;
let cleanupInProgress: Promise<boolean> | null = null;

export function isLssCacheCleanupDue(lastCompletedAt: number, now: number): boolean {
  return !Number.isFinite(lastCompletedAt) || lastCompletedAt <= 0
    || now < lastCompletedAt || now - lastCompletedAt >= LSS_CACHE_CLEANUP_INTERVAL_MS;
}

function lastCleanupAt(): number {
  try {
    const stored = Number(window.localStorage.getItem(LAST_CLEANUP_KEY));
    return Math.max(lastCleanupInMemory, Number.isFinite(stored) ? stored : 0);
  } catch {
    return lastCleanupInMemory;
  }
}

function markCleanupCompleted(now: number): void {
  lastCleanupInMemory = now;
  try { window.localStorage.setItem(LAST_CLEANUP_KEY, String(now)); }
  catch { /* Storage may be disabled; in-memory throttling still applies. */ }
}

/**
 * Called only from LSS Process, before creating new canonical image data.
 * No timers, resident workers, access-time writes or inspection of other
 * applications' IndexedDB databases. A failed cleanup is retried next Process.
 * Existing pre-timestamped scratch IDs are intentionally not migrated/deleted.
 */
export function cleanupLssTemporaryCacheOnProcess(protectedCanonicalSessionId?: string): Promise<boolean> {
  if (!isLssCacheCleanupDue(lastCleanupAt(), Date.now())) return Promise.resolve(false);
  if (cleanupInProgress) return cleanupInProgress;
  const perform = async (): Promise<boolean> => {
    // Another tab might have finished cleanup while we were waiting for a lock.
    if (!isLssCacheCleanupDue(lastCleanupAt(), Date.now())) return false;
    const cutoffAt = Date.now() - LSS_CACHE_RETENTION_MS;
    const canonicalRemoved = await purgeExpiredCanonicalSessions(cutoffAt, protectedCanonicalSessionId);
    await purgeExpiredStackScratchSessions(cutoffAt);
    markCleanupCompleted(Date.now());
    if (canonicalRemoved) console.info(`LSS cache cleanup: removed ${canonicalRemoved} expired canonical sessions.`);
    return true;
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // Web Locks' request overload may type an async callback as Promise<Promise<boolean>>.
  // Async/await unwraps it into one Promise<boolean> without changing lock behavior.
  const promise: Promise<boolean> = (async () => {
    if (locks?.request) return await locks.request(CLEANUP_LOCK_NAME, perform);
    return await perform();
  })();
  cleanupInProgress = promise.finally(() => { cleanupInProgress = null; });
  return cleanupInProgress;
}
