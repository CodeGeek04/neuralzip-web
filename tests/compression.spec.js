import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import '../src/codec/decoder.js';
import '../src/codec/archive.js';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const baselineRun = process.env.NEURALZIP_BASELINE === '1';
const baseline = process.env.NEURALZIP_BASELINE_REPORT
  ? JSON.parse(await readFile(process.env.NEURALZIP_BASELINE_REPORT, 'utf8')) : [];

test.describe('fresh browser compression', () => {
  test.skip(process.env.NEURALZIP_COMPRESSION_CHECKS !== '1', 'Long learning runs are verified in the dedicated compression workflow.');
  test.afterAll(async () => {
    if (process.env.NEURALZIP_COMPRESSION_REPORT) {
      await writeFile(process.env.NEURALZIP_COMPRESSION_REPORT, JSON.stringify(results, null, 2) + '\n');
    }
  });
  for (const [name, limit] of [['alice-11kb', 11264], ['alice-complete', Infinity]]) {
    test(`${name} includes the model and restores every original byte`, async ({ page }, info) => {
      test.setTimeout(30 * 60 * 1000);
      const input = (await readFile(path.join(root, 'public/samples/alice.txt'))).subarray(0, limit);
      await page.goto('/');
      const timer = setInterval(async () => {
        try { console.log(name, await page.evaluate(() => window.compressionProgress || 'starting')); } catch { /* closed page */ }
      }, 30000);
      let result;
      try {
        result = await page.evaluate(({ bytes, name }) => new Promise((resolve, reject) => {
          const worker = new Worker('/runtime/codec-worker.js', { type: 'module' });
          let training;
          worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
          worker.onmessage = ({ data }) => {
            if (data.type === 'progress') {
              window.compressionProgress = data;
              if (data.stage === 'training') training = data;
            } else if (data.type === 'error') {
              worker.terminate(); reject(new Error(data.message));
            } else if (data.type === 'result') {
              const archive = new Uint8Array(data.buffer);
              const pieces = [];
              for (let i = 0; i < archive.length; i += 16384) pieces.push(String.fromCharCode(...archive.subarray(i, i + 16384)));
              worker.terminate();
              resolve({ ...data, buffer: undefined, archive: btoa(pieces.join('')), training });
            }
          };
          worker.postMessage({ action: 'encode', name: name + '.txt', file: new File([new Uint8Array(bytes)], name + '.txt') });
        }), { bytes: Array.from(input), name });
      } finally { clearInterval(timer); }

      const archive = Buffer.from(result.archive, 'base64');
      const { header, payload } = globalThis.LCPArchive.parseRaw(archive);
      const model = globalThis.LCPArchive.neuralModel(header, payload);
      const output = new Uint8Array(header.size);
      for (const segment of header.model.segments) {
        globalThis.BookDecoder.decodeSegment(model, segment, payload.subarray(segment.offset, segment.offset + segment.length),
          (chunk, bytes) => output.set(bytes, chunk * model.meta.chunk_len));
      }
      expect(Buffer.from(output)).toEqual(input);
      expect(header.sha256).toBe(createHash('sha256').update(input).digest('hex'));
      expect(result.verified).toBe(true);
      const row = { name, originalBytes: input.length, archiveBytes: archive.length,
        weightsBytes: result.weightsBytes, streamBytes: result.streamBytes, settingsBytes: result.settingsBytes,
        ratio: input.length / archive.length, seconds: result.seconds, config: model.config,
        training: result.training, exactBytesVerified: true };
      results.push(row);
      console.log(JSON.stringify(row));
      await writeFile(info.outputPath(name + '.nzip'), archive);
      if (!baselineRun) {
        expect(archive.length).toBeLessThan(input.length);
        const previous = baseline.find(row => row.name === name);
        if (previous) expect(archive.length).toBeLessThan(previous.archiveBytes);
      }
    });
  }
});
