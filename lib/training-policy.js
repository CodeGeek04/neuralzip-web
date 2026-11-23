// Learning is governed by data coverage and convergence, never elapsed time.
export const CHECK_EVERY = 32;
export const CHUNK_LENGTH = 252;

export function trainingConfig(byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) throw new Error('Training needs nonempty input.');
  // Short files cannot pay for book-sized models. Keep q8 / bf16 precision.
  const [width, layers, heads] = byteLength <= 32768 ? [8, 1, 1]
    : byteLength <= 131072 ? [16, 2, 1]
    : byteLength <= 1000000 ? [24, 4, 1] : [48, 4, 2];
  return { vocab_size: 257, n_layer: layers, d_model: width, n_head: heads,
    d_ff: width * 3, max_len: Math.min(CHUNK_LENGTH, Math.max(4, byteLength)) + 4, rope_theta: 10000 };
}

export function evaluationChunks(count, maximum = 64) {
  const size = Math.min(count, maximum);
  return Array.from({ length: size }, (_, i) => size === 1 ? 0 : Math.floor(i * (count - 1) / (size - 1)));
}

export class ChunkSampler {
  constructor(count, random = Math.random) {
    this.order = Uint32Array.from({ length: count }, (_, i) => i);
    this.random = random;
    this.position = count;
    this.epochs = 0;
  }
  next(size) {
    if (this.position === this.order.length) {
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
      }
      this.position = 0;
    }
    const result = this.order.slice(this.position, Math.min(this.order.length, this.position + size));
    this.position += result.length;
    if (this.position === this.order.length) this.epochs++;
    return result;
  }
}

export class TrainingConvergence {
  constructor({ minSteps = 256, minEpochs = 2, patience = 12, minDelta = 0.01 } = {}) {
    Object.assign(this, { minSteps, minEpochs, patience, minDelta });
    this.checks = 0;
    this.best = Infinity;
    this.history = [];
  }
  observe(bitsPerByte, { steps, epochs }) {
    if (!Number.isFinite(bitsPerByte) || bitsPerByte < 0) throw new Error('Model learning became unstable. No archive was saved.');
    this.checks++;
    const improved = bitsPerByte < this.best;
    this.best = Math.min(this.best, bitsPerByte);
    this.history.push(this.best);
    if (this.history.length > this.patience) this.history.shift();
    const stable = this.history.length === this.patience && this.history[0] - this.best < this.minDelta;
    const ready = steps >= this.minSteps && epochs >= this.minEpochs;
    return { improved, done: ready && (this.best <= 0.01 || stable), best: this.best };
  }
}
