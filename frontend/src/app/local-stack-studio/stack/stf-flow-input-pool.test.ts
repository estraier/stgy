import { StfFlowInputPool, stfFlowPairConcurrency } from "./stf-flow-input-pool";

describe("STF Phase 4: bounded reuse of aligned images and Gray8", () => {
  test("two adjacent pairs read each real image only once and share exactly one proxy", async () => {
    let activeReads = 0;
    let maxReads = 0;
    const calls: number[] = [];
    const reader = {
      width: 4, height: 3,
      async readGamma2Image(index: number, range: 1 | 4 = 1) {
        expect(range).toBe(4);
        activeReads++;
        maxReads = Math.max(maxReads, activeReads);
        calls.push(index);
        await Promise.resolve();
        activeReads--;
        return new Uint16Array(4 * 3 * 3).fill((index + 1) * 1000);
      },
    };
    const pool = new StfFlowInputPool(reader, 3);
    const [ab, bc] = await Promise.all([pool.acquirePair(0,1), pool.acquirePair(1,2)]);
    expect(calls).toHaveLength(3);
    expect([...calls].sort()).toEqual([0,1,2]);
    expect(maxReads).toBe(1); // no concurrent ~230MiB Float32 aligned decodes
    expect(ab.next.rgb).toBe(bc.previous.rgb);
    expect(ab.next.gray).toBe(bc.previous.gray);
    expect(pool.stats().alignedReads).toBe(3);
    expect(pool.stats().grayPreparations).toBe(3);
    expect(pool.stats().sharedImageHits).toBe(1);
    ab.release(); bc.release();
    const cd = await pool.acquirePair(2,3);
    expect(calls).toHaveLength(4); // reused C; only D read
    cd.release();
    expect(pool.stats().residentImageCount).toBeLessThanOrEqual(3);
  });

  test("a failed decode releases reservations; the same image may be retried", async () => {
    let failures = 1;
    const reader = { width: 2, height: 1, async readGamma2Image(index: number) {
      if (index === 0 && failures--) throw new Error("decode failed");
      return new Uint16Array(6);
    } };
    const pool = new StfFlowInputPool(reader, 2);
    await expect(pool.acquirePair(0,1)).rejects.toThrow("decode failed");
    const pair = await pool.acquirePair(0,1);
    pair.release();
    expect(pool.stats().alignedReads).toBeGreaterThanOrEqual(2);
  });

  test("2 pairs require sufficient cores, RAM and working-set budget", () => {
    expect(stfFlowPairConcurrency(5184,3888,8,8)).toBe(2);
    expect(stfFlowPairConcurrency(5184,3888,4,8)).toBe(1);
    expect(stfFlowPairConcurrency(5184,3888,8,4)).toBe(1);
    expect(stfFlowPairConcurrency(5184,3888,8,undefined)).toBe(1);
    expect(stfFlowPairConcurrency(12000,9000,16,8)).toBe(1);
  });
});
