import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const python = process.env.NEURALZIP_PYTHON || 'python3';
const fixture = name => path.join(root, 'tests/fixtures', name);
const text = '\ufeff  Hello, नमस्ते 🌍\nkeep\tthese spaces \n';
async function downloaded(page, info) {
  const pending = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const download = await pending, file = info.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  return { file, bytes: await readFile(file) };
}
async function audit(page) {
  expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
}
async function decodeTab(page) {
  await page.getByRole('tab', { name: /Decode/ }).click();
}

test('real training of pasted text restores exactly in Python with no remote requests', async ({ page }, info) => {
  const errors = [], remote = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173') && !r.url().startsWith('blob:')) remote.push(r.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Paste text', exact: true }).click();
  await page.getByLabel('Text to encode', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Encode file', exact: true }).click();
  await expect(page.locator('#progress-detail')).toContainText('Elapsed');
  const initial = await page.locator('#progress-detail').textContent();
  await expect.poll(() => page.locator('#progress-detail').textContent()).not.toBe(initial);
  await expect(page.locator('#output-result')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#result-note')).toContainText('Model overhead');
  const output = await downloaded(page, info);
  expect(output.bytes.subarray(0,8).toString()).toBe('NEURZIP1');
  const header = JSON.parse(output.bytes.subarray(12, 12 + output.bytes.readUInt32LE(8)));
  expect(header.codec).toBe('neural'); expect(header.model.tensors.length).toBeGreaterThan(0);
  const restored = execFileSync(python, ['-c', 'import base64,sys; from neuralzip import decode; print(base64.b64encode(decode(sys.argv[1])).decode())', output.file]);
  expect(Buffer.from(restored.toString().trim(), 'base64')).toEqual(Buffer.from(text));
  await audit(page);
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});

test('watch mode displays actual chunks before completion and supports pause/resume', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(fixture('neural.nzip'));
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await page.getByLabel('Reveal speed').selectOption('150');
  await expect.poll(() => page.locator('#watch-chunk-count').getAttribute('data-chunk')).not.toBe('0');
  await page.getByRole('button', { name: 'Pause reconstruction' }).click();
  await expect(page.getByRole('button', { name: 'Resume reconstruction' })).toBeVisible();
  const pausedChunk = await page.locator('#watch-chunk-count').getAttribute('data-chunk');
  await page.waitForTimeout(220);
  await expect(page.locator('#watch-chunk-count')).toHaveAttribute('data-chunk', pausedChunk);
  await expect(page.locator('#download-button')).toBeHidden();
  const expected = await readFile(fixture('neural.txt'));
  await expect(page.locator('#live-preview')).toContainText(expected.subarray(0,100).toString());
  await page.getByRole('button', { name: 'Resume reconstruction' }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  expect((await downloaded(page, info)).bytes).toEqual(expected);
  await expect(page.locator('#live-preview')).toHaveText(expected.toString());
});

test('ordinary decoding works with watch disabled', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(fixture('neural.nzip'));
  await page.getByLabel('Watch reconstruction').uncheck();
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  await expect(page.locator('#live-preview')).toHaveCount(0);
  expect((await downloaded(page, info)).bytes).toEqual(await readFile(fixture('neural.txt')));
});

test('pasted UTF-8 byte counts and large-file guidance impose no 1 MB cutoff', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Paste text', exact: true }).click();
  await page.getByLabel('Text to encode', { exact: true }).fill('नमस्ते 🌍');
  await expect(page.locator('#paste-size')).toContainText(Buffer.byteLength('नमस्ते 🌍').toLocaleString()+' B');
  await page.getByLabel('Text to encode', { exact: true }).fill('a'.repeat(1_000_001));
  await expect(page.locator('#job-estimate')).toContainText('A larger experiment');
  await expect(page.getByRole('button', { name: 'Encode file', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  await page.locator('#file-input').setInputFiles({ name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(1_000_001, 65) });
  await expect(page.locator('#file-name')).toHaveText('large.txt');
  await expect(page.locator('#job-estimate')).toContainText('many minutes');
  await expect(page.getByRole('button', { name: 'Encode file', exact: true })).toBeEnabled();
});

test('encoding samples and multiple book samples are selectable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Samples', exact: true }).click();
  await page.getByRole('button', { name: /Structured logs/ }).click();
  await expect(page.locator('#file-name')).toHaveText('events.jsonl');
  await expect(page.getByRole('button', { name: 'Encode file', exact: true })).toBeEnabled();
  await decodeTab(page);
  await page.getByRole('button', { name: 'Book library', exact: true }).click();
  await expect(page.getByRole('button', { name: /Alice in Wonderland/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /The Yellow Wallpaper/ })).toBeVisible();
  await page.getByRole('button', { name: /Five-book collection/ }).click();
  await expect(page.locator('#file-name')).toHaveText('library-neural.nzip');
  await expect(page.locator('#job-estimate')).toContainText('A larger experiment');
  await expect(page.getByRole('button', { name: 'Decode archive', exact: true })).toBeEnabled();
});

test('short classic model reconstructs its complete original text', async ({ page }, info) => {
  await page.goto('/'); await decodeTab(page);
  await page.getByRole('button', { name: 'Book library', exact: true }).click();
  await page.getByRole('button', { name: /A Modest Proposal/ }).click();
  await expect(page.locator('#file-name')).toHaveText('modest-proposal.nzip');
  await page.getByLabel('Watch reconstruction').uncheck();
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  expect((await downloaded(page, info)).bytes).toEqual(await readFile(path.join(root, 'public/samples/modest-proposal.txt')));
});

test('empty text file round trip works', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
  await page.getByRole('button', { name: 'Encode file', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  const output = await downloaded(page, info);
  await page.locator('#file-input').setInputFiles(output.file);
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  expect((await downloaded(page, info)).bytes.length).toBe(0);
});

test('damaged archive and binary text input show actionable errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'broken.nzip', mimeType: 'application/octet-stream', buffer: Buffer.from('not an archive') });
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#error-message')).toContainText(/archive/i);
  await expect(page.locator('#download-button')).toBeHidden();
  await page.getByRole('tab', { name: /Encode/ }).click();
  await page.locator('#file-input').setInputFiles({ name: 'binary.txt', mimeType: 'text/plain', buffer: Buffer.from([0,255,1,2]) });
  await page.getByRole('button', { name: 'Encode file', exact: true }).click();
  await expect(page.locator('#error-message')).toContainText('UTF-8 text file');
});

test('cancel a watched job and start again without stale text or workers', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(fixture('neural.nzip'));
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#live-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#output-empty')).toBeVisible();
  await expect(page.locator('#live-preview')).toHaveCount(0);
  await page.getByLabel('Watch reconstruction').uncheck();
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  expect((await downloaded(page, info)).bytes).toEqual(await readFile(fixture('neural.txt')));
});

test('keyboard navigation, professional layouts and accessibility', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Encode/ }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Decode/ })).toBeFocused(); await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: /Encode/ })).toBeFocused();
  await audit(page);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true });
  if (process.env.NEURALZIP_SCREENSHOT) await page.screenshot({ path: path.join(root, 'docs/playground.png'), fullPage: true });
  for (const width of [390,320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Paste text', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await audit(page); await decodeTab(page);
    await page.getByRole('button', { name: 'Book library', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await audit(page); await page.getByRole('tab', { name: /Encode/ }).click();
  }
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
  for (const route of ['/docs/','/benchmarks/']) { await page.goto(route); await audit(page); }
});

test('published package, source, samples and measurements are downloadable', async ({ request }) => {
  for (const name of ['downloads/neuralzip-0.3.1-py3-none-any.whl','downloads/neuralzip-0.3.1.tar.gz','FORMAT.txt','LICENSE.txt','benchmarks.json','samples/modest-proposal.nzip','samples/yellow-wallpaper.nzip']) {
    const response = await request.get('/' + name);
    expect(response.ok(), name).toBe(true);
    expect((await response.body()).length).toBeGreaterThan(100);
  }
});
