import test from 'node:test';
import assert from 'node:assert/strict';
import * as tf from '@tensorflow/tfjs';
import { archiveWeights, bf16, bfValue, roundEven } from '../src/training-math.js';

await tf.setBackend('cpu');
await tf.ready();

test('training sees the exact q8 values that archive packing writes', async () => {
  const data = Float32Array.from({ length: 384 }, (_, i) => Math.sin(i * 1.37) * (i % 4 + 1) / 10);
  const rows = 16, cols = 24, expected = [];
  for (let r = 0; r < rows; r++) {
    let max = 1e-8;
    for (let c = 0; c < cols; c++) max = Math.max(max, Math.abs(data[r * cols + c]));
    const scale = bfValue(bf16(max / 127));
    for (let c = 0; c < cols; c++) expected.push(Math.fround(Math.max(-127, Math.min(127, roundEven(data[r * cols + c] / scale))) * scale));
  }
  const actual = tf.tidy(() => archiveWeights(tf.tensor2d(data, [rows, cols])));
  assert.deepEqual(Array.from(await actual.data()), expected);
  actual.dispose();
});
test('normalization weights use archive bf16 rounding, including ties and zero', async () => {
  const data = Float32Array.from([0, 1, -1, 1.00390625, 1.01171875, -1.00390625, 0.0000234, 37.251]);
  const actual = tf.tidy(() => archiveWeights(tf.tensor1d(data)));
  assert.deepEqual(Array.from(await actual.data()), Array.from(data, x => bfValue(bf16(x))));
  actual.dispose();
});
test('rounding keeps gradients flowing to master weights and releases temporary tensors', async () => {
  const before = tf.memory().numTensors;
  const gradient = tf.tidy(() => tf.grad(x => archiveWeights(x).sum())(tf.tensor2d([[0.11, -0.23], [0.35, -0.47]])));
  assert.deepEqual(Array.from(await gradient.data()), [1, 1, 1, 1]);
  gradient.dispose();
  assert.equal(tf.memory().numTensors, before);
});
