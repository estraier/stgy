/** Bounded, single-flight preparation of aligned full-resolution STF inputs.
 * Both RGB16 and bit-identical 4MP Gray8 proxies are prepared once per image
 * while neighboring Flow pairs are in flight. No global/IndexedDB cache.
 */
import { stfFlowWorkingSize, stfGamma2RgbToGray8Resampled } from "./stf-flow-gray";
import type { AlignedImageReader } from "./aligned-reader";

type PreparedInput = { rgb: Uint16Array; gray: Uint8Array };
type Entry = { promise: Promise<PreparedInput>; users: number; usedAt: number };
export type StfPreparedPair = { previous: PreparedInput; next: PreparedInput; release: () => void };
export type StfInputPoolStats = {
  alignedReads: number; sharedImageHits: number; grayPreparations: number;
  alignedReadMs: number; grayPreparationMs: number;
  residentImageCount: number; residentBytes: number; peakResidentBytes: number;
};

export class StfFlowInputPool {
  private readonly entries = new Map<number, Entry>();
  private readonly size: {width: number; height: number};
  private clock = 0;
  // Decoding one 20MP aligned image temporarily allocates a ~231MiB Float32
  // image. Serialize those reads even when two Flow pairs run concurrently.
  private readTail: Promise<void> = Promise.resolve();
  private peakResidentBytes = 0;
  private readonly measurements = {
    alignedReads: 0, sharedImageHits: 0, grayPreparations: 0,
    alignedReadMs: 0, grayPreparationMs: 0,
  };

  constructor(private readonly reader: Pick<AlignedImageReader, "width" | "height" | "readGamma2Image">,
    private readonly maxImages: number) {
    if (!Number.isInteger(maxImages) || maxImages < 2) throw new Error("Invalid STF Flow input pool capacity");
    this.size = stfFlowWorkingSize(reader.width, reader.height);
  }

  private residentBytes(): number {
    return [...this.entries.values()].length * (this.reader.width * this.reader.height * 3 * 2 + this.size.width * this.size.height);
  }

  private trim(): void {
    while (this.entries.size > this.maxImages) {
      const disposable = [...this.entries.entries()].filter(([, entry]) => entry.users === 0)
        .sort((a,b) => a[1].usedAt - b[1].usedAt)[0];
      if (!disposable) break; // A live pair has priority over the soft budget.
      this.entries.delete(disposable[0]);
    }
    this.peakResidentBytes = Math.max(this.peakResidentBytes, this.residentBytes());
  }

  private reserve(index: number): Entry {
    let entry = this.entries.get(index);
    if (entry) {
      this.measurements.sharedImageHits++;
    } else {
      const previousRead = this.readTail;
      let finishRead!: () => void;
      this.readTail = new Promise<void>((resolve) => { finishRead = resolve; });
      const promise = (async () => {
        await previousRead;
        try {
          const started = performance.now();
          const rgb = await this.reader.readGamma2Image(index, 4);
          this.measurements.alignedReadMs += performance.now() - started;
          this.measurements.alignedReads++;
          const grayStart = performance.now();
          const gray = stfGamma2RgbToGray8Resampled(rgb, this.reader.width, this.reader.height,
            this.size.width, this.size.height, 2);
          this.measurements.grayPreparationMs += performance.now() - grayStart;
          this.measurements.grayPreparations++;
          return { rgb, gray };
        } finally {
          finishRead();
        }
      })();
      entry = { promise, users: 0, usedAt: 0 };
      this.entries.set(index, entry);
    }
    entry.users++;
    entry.usedAt = ++this.clock;
    this.trim();
    return entry;
  }

  async acquirePair(previousIndex: number, nextIndex: number): Promise<StfPreparedPair> {
    if (previousIndex === nextIndex) throw new Error("An STF Flow pair requires distinct real inputs");
    // Reserve both synchronously before awaiting to deduplicate concurrent pairs.
    const first = this.reserve(previousIndex);
    const second = this.reserve(nextIndex);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      first.users--;
      second.users--;
      this.trim();
    };
    try {
      const [previous, next] = await Promise.all([first.promise, second.promise]);
      return { previous, next, release };
    } catch (error) {
      release();
      // A failed preparation must not poison subsequent Process attempts.
      if (this.entries.get(previousIndex) === first) this.entries.delete(previousIndex);
      if (this.entries.get(nextIndex) === second) this.entries.delete(nextIndex);
      throw error;
    }
  }

  stats(): StfInputPoolStats {
    return { ...this.measurements, residentImageCount: this.entries.size,
      residentBytes: this.residentBytes(), peakResidentBytes: this.peakResidentBytes };
  }
  clear(): void { this.entries.clear(); }
}

/** Conservative policy. Browsers without reliable RAM estimates keep one
 * pair in flight. 20MP on an 8-core / 8GiB machine may use two (not three).
 */
export function stfFlowPairConcurrency(width: number, height: number,
  hardwareConcurrency?: number, deviceMemoryGiB?: number): number {
  if (!(Number.isFinite(hardwareConcurrency) && (hardwareConcurrency ?? 0) >= 8 &&
    Number.isFinite(deviceMemoryGiB) && (deviceMemoryGiB ?? 0) >= 8)) return 1;
  const flowPixels = stfFlowWorkingSize(width, height);
  const rgbBytes = width * height * 3 * 2;
  const flowBytes = flowPixels.width * flowPixels.height;
  // Account for RGB originals, worker-owned RGB clones, generated results,
  // full Flow fields and extra temporary/native headroom; still just an estimate.
  const perPairEstimate = rgbBytes * 5 + flowBytes * 26 + 256 * 1024 * 1024;
  return perPairEstimate * 2 <= 2.5 * 1024 * 1024 * 1024 ? 2 : 1;
}
