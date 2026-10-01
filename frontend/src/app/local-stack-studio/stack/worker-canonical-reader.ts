import {
  CANONICAL_WORKER_CACHE_BYTES,
  openCanonicalReadSession,
  type CanonicalReadSession,
} from "./canonical-source";
import {
  AlignedImageReader,
  type AlignmentPlanLike,
  type ResolvedAlignmentLike,
} from "./aligned-reader";

export type WorkerCanonicalReaderConfig = {
  sessionId: string;
  alignmentPlan: AlignmentPlanLike;
  matrices: Array<Float64Array | number[] | null>;
  cacheBytes?: number;
};

export class WorkerCanonicalReader {
  readonly aligned: AlignedImageReader;
  private closed = false;

  private constructor(
    private readonly session: CanonicalReadSession,
    alignmentPlan: AlignmentPlanLike,
    alignment: ResolvedAlignmentLike,
  ) {
    this.aligned = new AlignedImageReader(session, alignmentPlan, alignment);
  }

  static async open(config: WorkerCanonicalReaderConfig): Promise<WorkerCanonicalReader> {
    const cacheBytes = config.cacheBytes ?? CANONICAL_WORKER_CACHE_BYTES;
    const session = await openCanonicalReadSession(config.sessionId, cacheBytes);
    try {
      if (config.matrices.length !== session.images.length) {
        throw new Error(`Alignment matrix count ${config.matrices.length} does not match canonical image count ${session.images.length}.`);
      }
      return new WorkerCanonicalReader(session, config.alignmentPlan, { matrices: config.matrices });
    } catch (error) {
      session.close();
      throw error;
    }
  }

  get sessionId(): string { return this.session.id; }
  get imageCount(): number { return this.session.images.length; }
  get width(): number { return this.aligned.width; }
  get height(): number { return this.aligned.height; }
  get cacheBytes(): number { return this.session.chunkCache.sizeBytes; }
  get cacheEntries(): number { return this.session.chunkCache.sizeEntries; }

  readLinearRegion(imageIndex: number, x: number, y: number, width: number, height: number): Promise<Float32Array> {
    this.ensureOpen();
    return this.aligned.readLinearRegion(imageIndex, x, y, width, height);
  }

  readGamma2Region(imageIndex: number, x: number, y: number, width: number, height: number, linearRangeMax: 1 | 4 = 1): Promise<Uint16Array> {
    this.ensureOpen();
    return this.aligned.readGamma2Region(imageIndex, x, y, width, height, linearRangeMax);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.session.close();
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("Worker canonical reader is closed.");
  }
}
