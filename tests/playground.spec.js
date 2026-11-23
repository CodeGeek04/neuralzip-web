import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const python = process.env.NEURZIP_PYTHON || 'python3';
const fixture = name => path.join(root, 'tests/fixtures', name);
const bytes = Buffer.from('\ufeff  Hello, नमस्ते 🌍\r\nkeep\tthese spaces \r\n');
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

test('browser trains a model, keeps a larger archive and restores exactly in Python offline', async ({ page }, info) => {
  const errors = [], remote = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173') && !r.url().startsWith('blob:')) remote.push(r.url()); });
  await page.goto('/');
  await expect(page.locator('#compression-mode')).toHaveCount(0);
  await page.locator('#file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: bytes });
  await page.locator('#training-budget').selectOption('15');
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
  expect(output.bytes.length).toBeGreaterThan(bytes.length);
  const restored = execFileSync(python, ['-c', 'import base64,sys; from neurzip import decode; print(base64.b64encode(decode(sys.argv[1])).decode())', output.file]);
  expect(Buffer.from(restored.toString().trim(), 'base64')).toEqual(bytes);
  await audit(page);
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});

test('Python model archive restores in browser workers', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(fixture('neural.nzip'));
  await expect(page.getByRole('tab', { name: /Decode/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  expect((await downloaded(page, info)).bytes).toEqual(await readFile(fixture('neural.txt')));
});

test('empty input has the explicit empty neural record and restores in browser', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
  await page.getByRole('button', { name: 'Encode file', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  const output = await downloaded(page, info);
  const header = JSON.parse(output.bytes.subarray(12,12 + output.bytes.readUInt32LE(8)));
  expect(header.codec).toBe('neural'); expect(header.model).toBeNull();
  await page.locator('#file-input').setInputFiles(output.file);
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
  expect((await downloaded(page, info)).bytes.length).toBe(0);
});

test('Alice text sample is ready for user-controlled model training', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use Alice text' }).click();
  await expect(page.locator('#file-name')).toHaveText('alice.txt');
  await expect(page.getByRole('button', { name: 'Encode file', exact: true })).toBeEnabled();
});

test('complete research model restores every Alice byte and previews text', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore a sample model' }).click();
  await expect(page.locator('#output-result')).toBeVisible({ timeout: 90000 });
  expect((await downloaded(page, info)).bytes).toEqual(await readFile(path.join(root, 'public/samples/alice.txt')));
  await page.getByText('Preview restored text', { exact: true }).click();
  await expect(page.locator('#result-preview')).toContainText('Alice');
  if (process.env.NEURZIP_SCREENSHOT) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(root, 'docs/playground.png'), fullPage: true });
  }
});

test('damaged archive shows an error and no download', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'broken.nzip', mimeType: 'application/octet-stream', buffer: Buffer.from('not an archive') });
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#error-message')).toContainText(/archive/i);
  await expect(page.locator('#download-button')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Decode archive', exact: true })).toBeEnabled();
});

test('cancel model training returns to a usable state', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'tiny.txt', mimeType: 'text/plain', buffer: bytes });
  await page.getByRole('button', { name: 'Encode file', exact: true }).click();
  await expect(page.locator('#progress-title')).toHaveText('Learning your text', { timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#output-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Encode file', exact: true })).toBeEnabled();
});

test('cancel active restoration then start another job', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore a sample model' }).click();
  await expect(page.locator('#progress-title')).toHaveText('Restoring your text');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#output-empty')).toBeVisible();
  await page.locator('#file-input').setInputFiles(fixture('neural.nzip'));
  await page.getByRole('button', { name: 'Decode archive', exact: true }).click();
  await expect(page.locator('#output-result')).toBeVisible();
});

test('keyboard navigation, desktop/mobile layout and all-page accessibility', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Encode/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Decode/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: /Encode/ })).toBeFocused();
  await audit(page);
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true });
  for (const width of [390,320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await audit(page);
  }
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
  for (const route of ['/docs/','/benchmarks/']) {
    await page.goto(route);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await audit(page);
  }
});

test('package, source, format and current model measurements are downloadable', async ({ request }) => {
  for (const name of ['downloads/neurzip-0.3.0-py3-none-any.whl','downloads/neurzip-0.3.0.tar.gz','FORMAT.txt','LICENSE.txt','benchmarks.json']) {
    const response = await request.get('/' + name);
    expect(response.ok(), name).toBe(true);
    expect((await response.body()).length).toBeGreaterThan(100);
  }
  expect((await (await request.get('/benchmarks.json')).json()).version).toBe('neurzip/1');
});
