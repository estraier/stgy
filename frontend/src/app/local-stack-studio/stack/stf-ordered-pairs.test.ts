import { runStfOrderedPairs } from "./stf-ordered-pairs";

test("STF Phase 4 processes completed Flow pairs in original numeric order, not completion order", async () => {
  const releases = new Map<number, () => void>();
  const started: number[] = [];
  const consumed: number[] = [];
  const running = runStfOrderedPairs(3, 2,
    (index) => new Promise<number>((resolve) => {
      started.push(index);
      releases.set(index, () => resolve(index));
    }),
    async (index, result) => {
      expect(result).toBe(index);
      consumed.push(index);
    });
  expect(started).toEqual([0,1]);
  releases.get(1)!(); // pair 1 wins the race, but cannot merge before pair 0
  await Promise.resolve(); await Promise.resolve();
  expect(consumed).toEqual([]);
  releases.get(0)!();
  // Allow the async consume/launch loop to drain its microtasks.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(consumed).toEqual([0,1]);
  expect(started).toEqual([0,1,2]);
  releases.get(2)!();
  await running;
  expect(consumed).toEqual([0,1,2]);
});

test("STF Phase 4 surfaces an error without leaving speculative work unobserved", async () => {
  await expect(runStfOrderedPairs(3, 2,
    async (index) => { if (index === 1) throw new Error("flow failed"); return index; },
    async () => {})).rejects.toThrow("flow failed");
});
