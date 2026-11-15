import { purgeExpiredCanonicalSessions } from "./canonical-source";
import { purgeExpiredStackScratchSessions } from "./scratch";
import { purgeExpiredStfFlowSessions } from "./stf-flow-cache";

// Strict creation-time expiry. An active tab is deliberately NOT exempt.
export const LSS_CACHE_RETENTION_MS = 1_800_000;
let cleanupInProgress: Promise<void> | null = null;

/**
 * Invoked only when a new Canonical input session is about to be created.
 * Sweep all expired LSS-owned persistent sessions, even those in other tabs.
 * No heartbeat, protected-session list, content fingerprint, or throttle.
 */
export function cleanupLssTemporaryCacheOnNewSession(): Promise<void> {
  if (cleanupInProgress) return cleanupInProgress;
  const cleanup = (async () => {
    const cutoffAt = Date.now() - LSS_CACHE_RETENTION_MS;
    const canonicalRemoved = await purgeExpiredCanonicalSessions(cutoffAt);
    await purgeExpiredStackScratchSessions(cutoffAt);
    const flowRemoved = await purgeExpiredStfFlowSessions(cutoffAt);
    if (canonicalRemoved || flowRemoved) console.info(
      `LSS session cleanup: ${canonicalRemoved} expired canonical session(s), ${flowRemoved} Flow pair(s).`);
  })();
  cleanupInProgress = cleanup.finally(() => { cleanupInProgress = null; });
  return cleanupInProgress;
}
