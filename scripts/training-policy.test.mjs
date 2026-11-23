import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkSampler, evaluationChunks, trainingConfig, TrainingConvergence } from '../lib/training-policy.js';

test('a sample plateau cannot stop training before the input has been covered', () => {
  const policy = new TrainingConvergence();
  for (let i = 1; i <= 20; i++) assert.equal(policy.observe(7.5, { steps: i * 32, epochs: 0 }).done, false);
  assert.equal(policy.observe(7.5, { steps: 672, epochs: 2 }).done, true);
});
test('memorizing a sample cannot stop the first few updates', () => {
  const policy = new TrainingConvergence();
  assert.equal(policy.observe(0, { steps: 32, epochs: 10 }).done, false);
  assert.equal(policy.observe(0, { steps: 256, epochs: 10 }).done, true);
});
test('keeps learning while improvements continue, without a wall-clock cutoff', () => {
  const policy = new TrainingConvergence();
  for (let i = 0; i < 100; i++) assert.equal(policy.observe(8 - i * 0.05, { steps: (i + 1) * 32, epochs: 10 }).done, false);
});
test('tracks the best checkpoint rather than a worse final update', () => {
  const policy = new TrainingConvergence();
  assert.equal(policy.observe(4, { steps: 32, epochs: 2 }).improved, true);
  const later = policy.observe(4.5, { steps: 64, epochs: 2 });
  assert.equal(later.improved, false);
  assert.equal(later.best, 4);
});
test('rejects non-finite learning results instead of emitting invalid weights', () => {
  for (const value of [NaN, Infinity, -1]) assert.throws(() => new TrainingConvergence().observe(value, { steps: 32, epochs: 2 }), /unstable/);
});

test('training visits every chunk exactly once per pass, including the partial batch', () => {
  const sampler = new ChunkSampler(45, () => 0.37);
  for (let epoch = 1; epoch <= 3; epoch++) {
    const visited = [];
    while (sampler.epochs < epoch) visited.push(...sampler.next(8));
    assert.equal(visited.length, 45);
    assert.equal(new Set(visited).size, 45);
    assert.deepEqual([...visited].sort((a, b) => a - b), Array.from({ length: 45 }, (_, i) => i));
  }
});
test('evaluation spans a book and includes all chunks of short files', () => {
  assert.deepEqual(evaluationChunks(45), Array.from({ length: 45 }, (_, i) => i));
  const sample = evaluationChunks(600);
  assert.equal(sample.length, 64);
  assert.equal(new Set(sample).size, 64);
  assert.equal(sample[0], 0); assert.equal(sample.at(-1), 599);
});
test('book inputs match the CLI architecture while short inputs use a smaller model', () => {
  const book = trainingConfig(151094), short = trainingConfig(11264);
  assert.deepEqual(book, { vocab_size: 257, n_layer: 4, d_model: 24, n_head: 1, d_ff: 72, max_len: 256, rope_theta: 10000 });
  assert.ok(short.d_model < book.d_model && short.n_layer < book.n_layer);
  assert.equal(trainingConfig(6538002).d_model, 48);
  assert.equal(trainingConfig(1).max_len, 8);
});
