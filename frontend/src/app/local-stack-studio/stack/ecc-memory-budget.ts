/**
 * A browser cannot reliably query free physical RAM. Device Memory is only a
 * rounded capacity hint, so leave explicit headroom for canonical caches,
 * image decoding, the UI, and the OS. Never treat this as an allocation grant.
 */
const GIB = 1024 ** 3;
const ECC16_WORKER_ESTIMATE_BYTES = 1.6 * GIB; // 16MP 6-DOF ECC: measured WASM heap ~1.3GiB plus margin.
const ECC16_NON_WORKER_RESERVE_BYTES = 1.25 * GIB;
const ECC16_UNKNOWN_MEMORY_WORKERS = 2;
const ECC16_MAX_WORKERS = 4;

export function chooseEcc16WorkerCount({
  jobCount, hardwareConcurrency, deviceMemoryGiB, proxyBytes = 0,
}: {
  jobCount: number;
  hardwareConcurrency?: number | null;
  deviceMemoryGiB?: number | null;
  proxyBytes?: number;
}): number {
  const jobs = Math.max(0, Math.floor(jobCount));
  if (jobs === 0) return 0;
  const hardware = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(Number(hardwareConcurrency))) : ECC16_MAX_WORKERS;
  let memoryWorkers = ECC16_UNKNOWN_MEMORY_WORKERS;
  if (Number.isFinite(deviceMemoryGiB) && Number(deviceMemoryGiB) > 0) {
    const disposableBytes = Number(deviceMemoryGiB) * GIB - ECC16_NON_WORKER_RESERVE_BYTES
      - Math.max(0, Number.isFinite(proxyBytes) ? proxyBytes : 0);
    memoryWorkers = Math.max(1, Math.floor(disposableBytes / ECC16_WORKER_ESTIMATE_BYTES));
  }
  return Math.max(1, Math.min(jobs, hardware, ECC16_MAX_WORKERS, memoryWorkers));
}

/** Only retry failures that explicitly indicate memory exhaustion. Do not
 * hide genuine ECC convergence/validation failures behind memory retries. */
export function isEccOutOfMemoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:insufficient\s+memory|out\s*of\s*memory|OutOfMemoryError|failed\s+to\s+allocate|cannot\s+enlarge\s+memory|memory\.grow\s+failed|arraybuffer\s+allocation\s+failed)/i.test(message);
}
