import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { bf16, bfValue, roundEven } from '../src/training-math.js';

const { outputFiles } = await build({
  stdin: { resolveDir: path.resolve(import.meta.dirname, '..'), contents: `
    import * as tf from '@tensorflow/tfjs';
    import { archiveWeights } from './src/training-math.js';
    globalThis.weightProbe = async () => {
      await tf.setBackend('webgl'); await tf.ready();
      const matrix = tf.tensor2d([[0,0,0],[.1,-.2,.3]]);
      const vector = tf.tensor1d([0,1,-1,1.00390625,1.01171875,-1.00390625]);
      const output = tf.tidy(() => [archiveWeights(matrix), archiveWeights(vector)]);
      const gradient = tf.tidy(() => tf.grad(x => archiveWeights(x).sum())(matrix));
      const result = { backend: tf.getBackend(), matrix: Array.from(await output[0].data()),
        vector: Array.from(await output[1].data()), gradient: Array.from(await gradient.data()) };
      tf.dispose([matrix,vector,...output,gradient]);
      return { ...result, tensorsAfterCleanup: tf.memory().numTensors };
    };
  ` },
  bundle: true, format: 'iife', platform: 'browser', write: false, minify: true,
});

test('WebGL learning weights match archive precision and keep finite gradients', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ content: outputFiles[0].text });
  const result = await page.evaluate(() => globalThis.weightProbe());
  const data = Float32Array.from([0.1,-0.2,0.3]);
  const scale = bfValue(bf16(Math.max(...Array.from(data, Math.abs)) / 127));
  expect(result.backend).toBe('webgl');
  expect(result.matrix).toEqual([0,0,0,...Array.from(data, x => Math.fround(roundEven(x / scale) * scale))]);
  expect(result.vector).toEqual([0,1,-1,1.00390625,1.01171875,-1.00390625].map(x => bfValue(bf16(x))));
  expect(result.gradient).toEqual([1,1,1,1,1,1]);
  expect(result.tensorsAfterCleanup).toBe(0);
});
