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

## Browser learning

Model capacity adapts to input size so short files do not carry a book-sized model. The browser retains its lightweight 60-byte context; it does not emulate the CLI's larger four-layer preset. A shuffled sampler visits every chunk in each completed pass. Convergence is measured across up to 64 chunks spanning the file, using the q8 matrices and bf16 values that are actually saved. Both learning and saved-weight refinement must see a minimum number of training chunks before a plateau can finish the phase. Learning continues while estimated model-plus-stream size improves materially, without an elapsed-time cutoff. Actual encoding and verification always cover every original byte. Small or difficult inputs can still grow.

The dedicated `Compare fresh browser compression` workflow compares fresh encodes with measured reference results from the released trainer on an 11 KiB Alice excerpt and complete Alice. The manual workflow can re-measure the reference. It measures the entire archive and independently decodes every byte. These longer learning runs execute on GitHub's runner, separately from ordinary UI tests.

## Host

**Vercel:** import this repository, keep Root Directory at the repository root, and deploy. The included `vercel.json` selects Next.js, `npm run build`, and automatically handles the static export. Keep the Output Directory setting at its Next.js default; do not override it with `out`. The prepared Python wheel and source downloads are already included. Vercel CLI deployment: `vercel --prod`.

**Netlify:** import this repository with the included `netlify.toml`. Build `npm run build`; publish `out`.

**Any static HTTPS host:** serve the contents of `out/`. Keep runtime chunks, `codec/`, `segment-worker.js`, samples and downloads together. HTTPS or localhost is needed for workers and SHA-256. No SPA catch-all rewrite is required.

For subdirectory hosting, build with `NEXT_PUBLIC_BASE_PATH=/neuralzip npm run build`; the same prefix applies to links, lazy chunks, nested workers, samples and downloads. Preview with the same environment variable. Rebuild without it for root hosting.

Social sharing uses a static 1200 × 630 PNG at `public/social/neuralzip-card-v2.png`, with its editable source in `docs/social-card.svg`. The illustrated sizes come from the five-book research archive in `public/benchmarks.json`, including the model and stream. Open Graph and X large-image metadata are included in the exported HTML. When hosting on a different domain, set `NEXT_PUBLIC_SITE_URL` to the public site origin before building so image URLs point to that deployment. The default is `https://neuralzip-web.vercel.app`.

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
