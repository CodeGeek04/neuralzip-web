import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

const site = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(site, 'public/codec'), { recursive: true });
for (const name of ['decoder.js', 'archive.js']) {
  await copyFile(path.join(site, 'src/codec', name), path.join(site, 'public/codec', name));
}
await rm(path.join(site, 'public/runtime'), { recursive: true, force: true });
await build({
  entryPoints: { 'codec-worker': path.join(site, 'src/worker.js') },
  outdir: path.join(site, 'public/runtime'),
  bundle: true, splitting: true, format: 'esm', platform: 'browser',
  target: 'es2022', minify: true, legalComments: 'eof',
  chunkNames: 'chunks/[name]-[hash]', logLevel: 'info',
});
