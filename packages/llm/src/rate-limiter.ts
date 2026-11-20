/**
 * Sliding-window requests-per-minute limiter, one per provider. Callers are
 * served in FIFO order. Process-local: two processes calling the same API do
 * not share a budget (fine for this prototype; see docs/phase-1-report.md).
 */
export class RateLimiter {
  private readonly stamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly requestsPerMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Resolves when a request may be sent. 0 rpm means unlimited. */
  acquire(): Promise<void> {
    if (this.requestsPerMinute <= 0) return Promise.resolve();
    const turn = this.queue.then(() => this.waitForSlot());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    const windowMs = 60_000;
    for (;;) {
      const t = this.now();
      while (this.stamps.length > 0 && this.stamps[0]! <= t - windowMs) this.stamps.shift();
      if (this.stamps.length < this.requestsPerMinute) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(this.stamps[0]! + windowMs - t + 5);
    }
  }
}
