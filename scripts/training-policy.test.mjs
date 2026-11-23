import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingConvergence } from '../lib/training-policy.js';

test('stops on a sustained plateau, even when the model is imperfect', () => {
  const policy = new TrainingConvergence();
  for (let i = 0; i < 7; i++) assert.equal(policy.observe(7.5).done, false);
  assert.equal(policy.observe(7.5).done, true);
});
test('keeps learning while improvements continue, without a wall-clock cutoff', () => {
  const policy = new TrainingConvergence();
  for (let i = 0; i < 100; i++) assert.equal(policy.observe(8 - i * 0.05).done, false);
});
test('tracks the best checkpoint rather than a worse final update', () => {
  const policy = new TrainingConvergence();
  assert.equal(policy.observe(4).improved, true);
  const later = policy.observe(4.5);
  assert.equal(later.improved, false);
  assert.equal(later.best, 4);
});
test('rejects non-finite learning results instead of emitting invalid weights', () => {
  for (const value of [NaN, Infinity, -1]) assert.throws(() => new TrainingConvergence().observe(value), /unstable/);
});
