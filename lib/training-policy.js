// Stop on learning convergence, never on elapsed time. This affects the model's
// efficiency only; the arithmetic stream and full verification preserve bytes.
export const CHECK_EVERY = 16;
export class TrainingConvergence {
  constructor() {
    this.checks = 0;
    this.best = Infinity;
    this.history = [];
  }
  observe(bitsPerByte) {
    if (!Number.isFinite(bitsPerByte) || bitsPerByte < 0) throw new Error('Model learning became unstable. No archive was saved.');
    this.checks++;
    const improved = bitsPerByte < this.best;
    this.best = Math.min(this.best, bitsPerByte);
    this.history.push(this.best);
    if (this.history.length > 6) this.history.shift();
    const stable = this.checks >= 8 && this.history.length === 6 && this.history[0] - this.best < 0.02;
    return { improved, done: this.checks >= 8 && (this.best <= 0.01 || stable), best: this.best };
  }
}
