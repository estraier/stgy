import { deleteCanonicalSession, purgeExpiredCanonicalSessions, type PreparedCanonicalSession } from "./canonical-source";
import { deleteStackScratchCanonicalSession, purgeExpiredStackScratchSessions } from "./scratch";
import { deleteStfFlowSession, purgeExpiredStfFlowSessions } from "./stf-flow-cache";

// Strict creation-time expiry. An active tab is deliberately NOT exempt.
export const LSS_CACHE_RETENTION_MS = 1_800_000;
let cleanupInProgress: Promise<void> | null = null;

/** Remove each store independently, and report errors rather than swallowing
 * them. A failed store cannot prevent the other stores from being cleaned. */
async function completeAllCleanup(tasks: readonly Promise<unknown>[]): Promise<unknown[]> {
  const outcomes = await Promise.allSettled(tasks);
  const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason),
    `LSS cleanup failed for ${failures.length} store(s).`);
  return outcomes.map((outcome) => (outcome as PromiseFulfilledResult<unknown>).value);
}

/** Immediate deletion for the previous selection's entire Canonical session. */
export async function deleteLssSession(session: PreparedCanonicalSession | string): Promise<void> {
  const sessionId = typeof session === "string" ? session : session.id;
  if (!sessionId) return;
  await completeAllCleanup([
    deleteCanonicalSession(session),
    deleteStackScratchCanonicalSession(sessionId),
    deleteStfFlowSession(sessionId),
  ]);
}

/** Invoked when a new Canonical input session starts. Strict creation-time
 * expiry across all tabs, with no heartbeat or protected-session exemption. */
export function cleanupLssTemporaryCacheOnNewSession(): Promise<void> {
  if (cleanupInProgress) return cleanupInProgress;
  const cleanup = (async () => {
    const cutoffAt = Date.now() - LSS_CACHE_RETENTION_MS;
    // Do not skip Flow/Scratch if a different store fails its sweep.
    const [canonicalRemoved, , flowRemoved] = await completeAllCleanup([
      purgeExpiredCanonicalSessions(cutoffAt),
      purgeExpiredStackScratchSessions(cutoffAt),
      purgeExpiredStfFlowSessions(cutoffAt),
    ]);
    if (canonicalRemoved || flowRemoved) console.info(
      `LSS session cleanup: ${canonicalRemoved} expired canonical session(s), ${flowRemoved} Flow pair(s).`);
  })();
  cleanupInProgress = cleanup.finally(() => { cleanupInProgress = null; });
  return cleanupInProgress;
}
