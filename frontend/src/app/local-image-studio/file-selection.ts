/** Invalidates results of older asynchronous file-selection requests. */
export class LatestFileSelection {
  private generation = 0;

  start(): number {
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }
}
