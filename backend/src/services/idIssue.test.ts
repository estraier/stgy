import { IdIssueService } from "./idIssue";

const TS_SHIFT = BigInt(20);
const WORKER_SHIFT = BigInt(12);
const ONE = BigInt(1);
const WORKER_MASK = (ONE << BigInt(8)) - ONE;
const SEQ_MASK = (ONE << BigInt(12)) - ONE;

function decode(hexId: string) {
  const n = BigInt("0x" + hexId);
  const ts = n >> TS_SHIFT;
  const worker = Number((n >> WORKER_SHIFT) & WORKER_MASK);
  const seq = Number(n & SEQ_MASK);
  return { n, ts, worker, seq };
}

describe("IdIssueService (issueId, 44+8+12, UPPERCASE hex)", () => {
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_750_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    (global as any).performance = { now: jest.fn(() => 0) };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("constructor validates workerId bounds and integer", () => {
    expect(() => new IdIssueService(-1)).toThrow();
    expect(() => new IdIssueService(256)).toThrow();
    expect(() => new IdIssueService(1.5 as unknown as number)).toThrow();
    expect(() => new IdIssueService(0)).not.toThrow();
    expect(() => new IdIssueService(255)).not.toThrow();
  });

  test("issues 16-char UPPERCASE hex IDs; increases numerically within same ms", async () => {
    const svc = new IdIssueService(7);
    const a = await svc.issueId();
    const b = await svc.issueId();
    expect(a).toMatch(/^[0-9A-F]{16}$/);
    expect(b).toMatch(/^[0-9A-F]{16}$/);
    expect(a.length).toBe(16);
    expect(b.length).toBe(16);
    const da = decode(a);
    const db = decode(b);
    expect(db.n).toBe(da.n + BigInt(1));
    expect(da.ts).toBe(BigInt(nowMs));
    expect(da.worker).toBe(7);
  });

  test("check date", async () => {
    const svc = new IdIssueService(7);
    const res = await svc.issue();
    expect(res.id).toBe("1977420DC0007000");
    expect(res.ms).toBe(1750000000000);
  });

  test("advancing to next millisecond bumps timestamp and resets seq", async () => {
    const svc = new IdIssueService(42);
    const id1 = await svc.issueId();
    const d1 = decode(id1);
    expect(d1.ts).toBe(BigInt(nowMs));
    expect(d1.seq).toBe(0);
    nowMs += 1;
    const id2 = await svc.issueId();
    const d2 = decode(id2);
    expect(d2.ts).toBe(BigInt(nowMs));
    expect(d2.seq).toBe(0);
    expect(d2.n).toBeGreaterThan(d1.n);
  });

  test("seq exhaustion within the same ms throws { code: 'SEQ_EXHAUSTED' }", async () => {
    const svc = new IdIssueService(5);
    for (let i = 0; i < 4096; i++) {
      await svc.issueId();
    }
    await expect(svc.issueId()).rejects.toMatchObject({ code: "SEQ_EXHAUSTED" });
  });

  test("different workerIds produce different worker field at the same timestamp", async () => {
    const s1 = new IdIssueService(1);
    const s2 = new IdIssueService(2);
    const id1 = await s1.issueId();
    const id2 = await s2.issueId();
    const d1 = decode(id1);
    const d2 = decode(id2);
    expect(d1.ts).toBe(BigInt(nowMs));
    expect(d2.ts).toBe(BigInt(nowMs));
    expect(d1.worker).toBe(1);
    expect(d2.worker).toBe(2);
    expect(d1.n).not.toBe(d2.n);
  });

  test("lexicographic order equals numeric order for IDs within the same ms", async () => {
    const svc = new IdIssueService(9);
    const ids = [await svc.issueId(), await svc.issueId(), await svc.issueId()];
    const sorted = [...ids].sort(); // fixed-length upper-hex, big-endian
    expect(ids).toEqual(sorted);
  });

  test("monotonic guard: clock going backward does not reduce timestamp or ID", async () => {
    const svc = new IdIssueService(10);
    const idA = await svc.issueId();
    const dA = decode(idA);
    expect(dA.ts).toBe(BigInt(nowMs));
    nowMs -= 100;
    const idB = await svc.issueId();
    const dB = decode(idB);
    expect(dB.ts).toBe(dA.ts);
    expect(dB.n).toBe(dA.n + BigInt(1));
    nowMs = Number(dA.ts) + 1;
    const idC = await svc.issueId();
    const dC = decode(idC);
    expect(dC.ts).toBe(BigInt(Number(dA.ts) + 1));
    expect(dC.seq).toBe(0);
    expect(dC.n).toBeGreaterThan(dB.n);
  });
});
