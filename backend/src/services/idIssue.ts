export class IdIssueService {
  private readonly workerId: number;
  private static readonly TS_BITS = BigInt(44);
  private static readonly WORKER_BITS = BigInt(8);
  private static readonly SEQ_BITS = BigInt(12);
  private static readonly TS_SHIFT =
    IdIssueService.WORKER_BITS + IdIssueService.SEQ_BITS;
  private static readonly WORKER_SHIFT = IdIssueService.SEQ_BITS;
  private static readonly ONE = BigInt(1);
  private static readonly SEQ_MAX =
    (IdIssueService.ONE << IdIssueService.SEQ_BITS) - IdIssueService.ONE;

  private lastMs: bigint = BigInt(-1);
  private seq: bigint = BigInt(0);
  private readonly baseWall = Date.now();
  private readonly basePerf = (globalThis.performance?.now?.() ?? 0);

  constructor(workerId: number) {
    if (!Number.isInteger(workerId) || workerId < 0 || workerId > 0xff) {
      throw new Error("workerId must be an integer in [0, 255]");
    }
    this.workerId = workerId;
  }

  async issueId(): Promise<string> {
    return this.nextHex64();
  }

  private nowMsBig(): bigint {
    const wall = Date.now();
    const mono = this.baseWall + ((globalThis.performance?.now?.() ?? 0) - this.basePerf);
    const n = Math.max(wall, Math.floor(mono));
    let ms = BigInt(n);
    if (ms < this.lastMs) ms = this.lastMs;
    return ms;
  }

  private nextHex64(): string {
    const now = this.nowMsBig();
    if (now === this.lastMs) {
      if (this.seq === IdIssueService.SEQ_MAX) {
        const err = new Error("SEQ_EXHAUSTED") as Error & { code: string };
        err.code = "SEQ_EXHAUSTED";
        throw err;
      }
      this.seq = this.seq + IdIssueService.ONE;
    } else {
      this.seq = BigInt(0);
      this.lastMs = now;
    }
    const id =
      (now << IdIssueService.TS_SHIFT) |
      (BigInt(this.workerId) << IdIssueService.WORKER_SHIFT) |
      this.seq;
    return id.toString(16).padStart(16, "0").toUpperCase();
  }
}
