# Neuralzip web

The independent Next.js playground for [Neuralzip](https://github.com/CodeGeek04/neuralzip), a model-based lossless text compressor. Every nonempty encode trains a small transformer and saves its weights with an arithmetic-coded stream. Decode restores exact original bytes without retraining. Files stay on the device.

## Run

Use Node.js 22:

```bash
npm ci
npm run dev
```

To preview the production static export:

```bash
npm run build
npm run preview
```

`out/` contains the deployable website. No Python, backend, API key or external model is required to build or use the site. TensorFlow.js loads only when training begins; deterministic restoration runs in a single worker. Upload UTF-8 files, paste text, or choose an encoding sample. Decode includes a book library and a watch reader with actual chunk-by-chunk reconstruction, pause/resume and reveal speed. Inputs over 1 MB show guidance instead of a hard cutoff; there is no total-job timeout. Browser memory and archive-format capacity still bound practical sizes. Encoding is always lossless. Browser training ends automatically when learning stabilizes, without a wall-clock cutoff or a user-selected quality setting. Every archive is decoded and verified before download. Short inputs may grow because of model overhead. Current complete-archive results and sample models are included.

## Host

**Vercel:** import this repository, keep Root Directory at the repository root, and deploy. The included `vercel.json` selects Next.js, `npm run build`, and automatically handles the static export. Keep the Output Directory setting at its Next.js default; do not override it with `out`. The prepared Python wheel and source downloads are already included. Vercel CLI deployment: `vercel --prod`.

**Netlify:** import this repository with the included `netlify.toml`. Build `npm run build`; publish `out`.

**Any static HTTPS host:** serve the contents of `out/`. Keep runtime chunks, `codec/`, `segment-worker.js`, samples and downloads together. HTTPS or localhost is needed for workers and SHA-256. No SPA catch-all rewrite is required.

For subdirectory hosting, build with `NEXT_PUBLIC_BASE_PATH=/neuralzip npm run build`; the same prefix applies to links, lazy chunks, nested workers, samples and downloads. Preview with the same environment variable. Rebuild without it for root hosting.

## Test

Install the Python package separately for interoperability tests:

```bash
python -m pip install neuralzip
npx playwright install chrome
NEURALZIP_PYTHON=python npm test
```

On Windows PowerShell, set `$env:NEURALZIP_PYTHON = "python"` first. Tests exercise real browser training, exact Python/browser reconstruction, empty/damaged archives, cancellation, progress, keyboard controls, mobile layouts, accessibility and downloads. Golden fixtures live in `tests/fixtures/`.

To check subdirectory deployment end to end:

```bash
NEXT_PUBLIC_BASE_PATH=/neuralzip npm run build
NEXT_PUBLIC_BASE_PATH=/neuralzip node scripts/check-base-path.mjs
```

## Shared decoder and releases

`src/codec/` contains the versioned decoder shared with the [Python library](https://github.com/CodeGeek04/neuralzip/tree/main/src/neuralzip/_js). The worker build copies it to `public/codec/` for nested workers. Keep those source copies and committed fixtures synchronized when changing numerical inference or the archive format. See [format specification](public/FORMAT.txt).

Package downloads are refreshed from the library checkout with `python scripts/prepare_release.py --website /path/to/neuralzip-web`. Generated runtime bundles, Next build output, Vercel state and credentials are ignored by Git. Release measurements and complete model samples are tracked.

[MIT](LICENSE). TensorFlow.js and runtime dependency notices are in `public/THIRD_PARTY_NOTICES.txt`.
