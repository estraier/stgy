/** Prefetch at most N Flow pairs while consuming results in fixed STF order.
 * A rejected speculative task is handled immediately and surfaced only when
 * its turn arrives. No completed frame is merged out of order.
 */
export async function runStfOrderedPairs<T>(count: number, concurrency: number,
  prepare: (index: number) => Promise<T>, consume: (index: number, result: T) => Promise<void>): Promise<void> {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Invalid STF pair scheduler configuration");
  }
  const pending = new Map<number, Promise<{ result: T } | { error: unknown }>>();
  let next = 0;
  try {
    for (let index = 0; index < count; index++) {
      while (next < count && next < index + concurrency) {
        const i = next++;
        pending.set(i, prepare(i).then((result) => ({ result }), (error: unknown) => ({ error })));
      }
      const completed = await pending.get(index)!;
      pending.delete(index);
      if ("error" in completed) throw completed.error;
      await consume(index, completed.result);
    }
  } finally {
    // Some already-started workers may still be executing after an error.
    await Promise.all(pending.values());
  }
}
