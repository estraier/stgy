import { StfDerivedStripeStaging } from "./stf-derived-staging";

describe("STF bounded derived intermediate staging", () => {
  const stripe = (count: number) => ({
    fineLogSum: new Float32Array(count),
    fineZero: new Uint8Array(count),
    coarseGroups: new Float32Array(count * 3),
  });

  test("keeps up to the budget in RAM and allows subsequent scratch-storage fallback", () => {
    const first = stripe(5); // 20 + 5 + 60 bytes
    const second = stripe(6); // 24 + 6 + 72 bytes
    const staging = new StfDerivedStripeStaging(100);
    expect(staging.put(0, first)).toBe(true);
    expect(staging.size).toBe(1);
    expect(staging.bytes).toBe(85);
    expect(staging.put(1, second)).toBe(false);
    expect(staging.size).toBe(1);
    expect(staging.take(1)).toBeNull();
    expect(staging.take(0)).toBe(first);
    expect(staging.bytes).toBe(0);
    expect(staging.put(1, second)).toBe(false); // one stripe exceeds limit
    staging.clear();
    expect(staging.size).toBe(0);
  });

  test("takes unmodified input buffers exactly once for zero-copy Worker transfer", () => {
    const staging = new StfDerivedStripeStaging(4096);
    const data = stripe(4);
    data.fineLogSum[0] = 7.125;
    expect(staging.put(4, data)).toBe(true);
    expect(() => staging.put(4, stripe(4))).toThrow();
    const returned = staging.take(4)!;
    expect(returned.fineLogSum).toBe(data.fineLogSum);
    expect(returned.fineZero).toBe(data.fineZero);
    expect(returned.coarseGroups).toBe(data.coarseGroups);
    expect(returned.fineLogSum[0]).toBe(7.125);
    expect(staging.take(4)).toBeNull();
    expect(() => new StfDerivedStripeStaging(-1)).toThrow();
  });
});
