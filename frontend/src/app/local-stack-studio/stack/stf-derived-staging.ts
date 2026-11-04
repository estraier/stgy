/** Ephemeral Sobel stripe buffers, bounded to avoid unbounded RAM on large photos.
 * Nonresident stripes are handled by the existing IndexedDB scratch fallback. */
export type StfDerivedStripe = {
  fineLogSum: Float32Array;
  fineZero: Uint8Array;
  coarseGroups: Float32Array;
};

export class StfDerivedStripeStaging {
  private readonly stripes = new Map<number, StfDerivedStripe>();
  private residentBytes = 0;

  constructor(readonly limitBytes: number) {
    if (!(Number.isFinite(limitBytes) && limitBytes >= 0)) {
      throw new Error("STF derived staging RAM budget is invalid.");
    }
  }

  get bytes(): number { return this.residentBytes; }
  get size(): number { return this.stripes.size; }

  put(index: number, stripe: StfDerivedStripe): boolean {
    if (!Number.isSafeInteger(index) || index < 0 || this.stripes.has(index)) {
      throw new Error("STF derived staging stripe index is invalid or duplicated.");
    }
    const bytes = stripe.fineLogSum.byteLength + stripe.fineZero.byteLength + stripe.coarseGroups.byteLength;
    if (bytes > this.limitBytes - this.residentBytes) return false;
    this.stripes.set(index, stripe);
    this.residentBytes += bytes;
    return true;
  }

  take(index: number): StfDerivedStripe | null {
    const value = this.stripes.get(index);
    if (!value) return null;
    this.stripes.delete(index);
    this.residentBytes -= value.fineLogSum.byteLength + value.fineZero.byteLength + value.coarseGroups.byteLength;
    return value;
  }

  clear(): void {
    this.stripes.clear();
    this.residentBytes = 0;
  }
}
