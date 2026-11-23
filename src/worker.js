import './codec/decoder.js';
import './codec/archive.js';

const A = globalThis.LCPArchive, D = globalThis.BookDecoder;
const MAX_RAW = 160 << 20;
let children = [];
let segmentWorkerURL;
const send = (event, transfer = []) => self.postMessage(event, transfer);
const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  b => b.toString(16).padStart(2, '0')).join('');

async function inspect(bytes) {
  if (bytes.length > MAX_RAW) throw new Error('This archive exceeds the browser size limit.');
  return A.parseRaw(bytes);
}

function neuralPayload(pkg, streams) {
  const blobs = {}, parts = [];
  let offset = 0;
  const append = (bytes) => {
    const loc = { offset, length: bytes.length };
    offset += bytes.length; parts.push(bytes); return loc;
  };
  for (const key of ['weights_b64', 'qdata_b64', 'scales_b64']) blobs[key] = append(D.base64ToBytes(pkg[key]));
  const segments = streams.map(s => ({ first: s.first, count: s.count, ...append(s.bytes) }));
  const payload = new Uint8Array(offset);
  let pos = 0; for (const part of parts) { payload.set(part, pos); pos += part.length; }
  return { payload, model: { config: pkg.config, meta: pkg.meta, tensors: pkg.tensors, blobs, bits: 20, segments } };
}

async function restoreNeural(header, payload, progress = true) {
  const out = new Uint8Array(header.size), received = new Uint8Array(header.model.meta.n_chunks);
  const segments = header.model.segments;
  const nWorkers = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1), segments.length);
  let complete = 0, completedBytes = 0, contiguous = 0, last = 0;
  try {
    await Promise.all(Array.from({ length: nWorkers }, (_, i) => new Promise((resolve, reject) => {
      const worker = new Worker(segmentWorkerURL);
      children.push(worker);
      worker.onerror = () => reject(new Error('A decoding worker stopped. Try again with a smaller archive.'));
      worker.onmessage = ({ data }) => {
        if (data.error) return reject(new Error(data.error));
        if (data.done) return resolve();
        const bytes = new Uint8Array(data.bytes), chunk = data.chunk;
        out.set(bytes, chunk * header.model.meta.chunk_len);
        received[chunk] = 1; complete++; completedBytes += bytes.length;
        while (contiguous < received.length && received[contiguous]) contiguous++;
        if (progress && (performance.now() - last > 100 || complete === received.length)) {
          send({ type: 'progress', stage: progress === 'verifying' ? 'verifying' : 'decoding', progress: complete / received.length,
            completedBytes, totalBytes: header.size, completedChunks: complete, totalChunks: received.length,
            preview: new TextDecoder().decode(out.subarray(0, Math.min(20000, contiguous * header.model.meta.chunk_len))) });
          last = performance.now();
        }
      };
      const indices = [];
      for (let j = i; j < segments.length; j += nWorkers) indices.push(j);
      worker.postMessage({ header, payload, indices });
    })));
  } finally { children.forEach(w => w.terminate()); children = []; }
  return out;
}

async function run({ action, buffer, name, seconds = 30, segmentWorkerURL: workerScript }) {
  segmentWorkerURL = workerScript;
  const input = new Uint8Array(buffer), started = performance.now();
  if (action === 'decode') {
    send({ type: 'progress', stage: 'reading', progress: 0 });
    const { header, payload } = await inspect(input);
    send({ type: 'metadata', header: { name: header.name, size: header.size, codec: header.codec } });
    const restored = header.size === 0 ? new Uint8Array(0) : await restoreNeural(header, payload);
    if (await digest(restored) !== header.sha256) throw new Error('Checksum mismatch. This archive could not be restored safely.');
    const output = restored.slice();
    send({ type: 'result', action, name: header.name, method: header.codec, originalBytes: restored.length,
      archiveBytes: input.length, sha256: header.sha256, verified: true,
      seconds: (performance.now() - started) / 1000, buffer: output.buffer }, [output.buffer]);
    return;
  }
  if (action !== 'encode') throw new Error('Choose Encode or Decode.');
  if (input.length > 500000) throw new Error('Browser encoding supports text up to 500 KB. Use Python for larger model jobs.');
  const header = { format: 'neurzip/1', codec: 'neural', name, size: input.length, sha256: await digest(input) };
  let archive, weightsBytes = 0, streamBytes = 0;
  if (!input.length) {
    archive = A.raw({ ...header, model: null }, new Uint8Array(0));
  } else {
    send({ type: 'progress', stage: 'preparing', progress: 0 });
    const { train } = await import('./neural.js');
    const pkg = await train(input, seconds, event => send({ type: 'progress', ...event }));
    pkg.meta.sha256 = header.sha256;
    const model = D.buildModel(pkg, D.decodeBlobs(pkg));
    const plan = D.segmentPlan(pkg.meta.n_chunks, Math.min(32, pkg.meta.n_chunks)), streams = [];
    let lastProgress = 0;
    for (const segment of plan) {
      streams.push({ ...segment, bytes: D.encodeSegment(model, input, segment.first, segment.count, c => {
        if (performance.now() - lastProgress > 100 || c + 1 === pkg.meta.n_chunks) {
          send({ type: 'progress', stage: 'encoding', progress: (c + 1) / pkg.meta.n_chunks,
            completedChunks: c + 1, totalChunks: pkg.meta.n_chunks,
            completedBytes: Math.min(input.length, (c + 1) * pkg.meta.chunk_len), totalBytes: input.length });
          lastProgress = performance.now();
        }
      }) });
    }
    const { payload, model: manifest } = neuralPayload(pkg, streams);
    const neuralHeader = { ...header, model: manifest };
    archive = A.raw(neuralHeader, payload);
    weightsBytes = Object.values(manifest.blobs).reduce((n, b) => n + b.length, 0);
    streamBytes = manifest.segments.reduce((n, b) => n + b.length, 0);
    send({ type: 'progress', stage: 'verifying', progress: 0 });
    const restored = await restoreNeural(neuralHeader, payload, 'verifying');
    if (await digest(restored) !== header.sha256) throw new Error('Verification failed. No archive was saved.');
  }
  send({ type: 'result', action, name: name + '.nzip', method: 'neural', originalBytes: input.length,
    archiveBytes: archive.length, weightsBytes, streamBytes,
    settingsBytes: archive.length - weightsBytes - streamBytes,
    sha256: header.sha256, verified: true,
    seconds: (performance.now() - started) / 1000, buffer: archive.buffer }, [archive.buffer]);
}

self.onmessage = ({ data }) => {
  if (data.action === 'cancel') { children.forEach(w => w.terminate()); children = []; self.close(); return; }
  run(data).catch(error => { children.forEach(w => w.terminate()); children = []; send({ type: 'error', message: error.message || 'Something went wrong. Please try again.' }); });
};
