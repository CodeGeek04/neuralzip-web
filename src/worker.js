import './codec/decoder.js';
import './codec/archive.js';
import { CHUNK_LENGTH } from '../lib/training-policy.js';

const A = globalThis.LCPArchive, D = globalThis.BookDecoder;
// Browser buffers and the archive's chunk-address space provide the technical bounds.
// The Python decoder retains its conservative 16 MiB default.
const MAX_BUFFER = 0xffffffff, MAX_CHUNKS = 16777216;
let nextChunk;
const send = (event, transfer = []) => self.postMessage(event, transfer);
const yieldTurn = () => new Promise(resolve => setTimeout(resolve, 0));
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  b => b.toString(16).padStart(2, '0')).join('');

async function validateText(input) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (let i = 0; i < input.length; i += 65536) {
      const text = decoder.decode(input.subarray(i, i + 65536), { stream: true });
      if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new Error('binary');
      if (i && i % (1 << 20) === 0) await yieldTurn();
    }
    decoder.decode();
  } catch { throw new Error('Choose a UTF-8 text file. PDF, images and other binary formats cannot be encoded in this playground.'); }
}

function neuralPayload(pkg, streams) {
  const blobs = {}, parts = [];
  let offset = 0;
  const append = bytes => {
    const loc = { offset, length: bytes.length };
    offset += bytes.length; parts.push(bytes); return loc;
  };
  for (const key of ['weights_b64', 'qdata_b64', 'scales_b64']) blobs[key] = append(D.base64ToBytes(pkg[key]));
  const segments = streams.map(s => ({ first: s.first, count: s.count, ...append(s.bytes) }));
  const payload = new Uint8Array(offset);
  let pos = 0; for (const part of parts) { payload.set(part, pos); pos += part.length; }
  return { payload, model: { config: pkg.config, meta: pkg.meta, tensors: pkg.tensors, blobs, bits: 20, segments } };
}

async function restoreNeural(header, payload, stage = 'decoding', watch = false) {
  const model = A.neuralModel(header, payload, MAX_BUFFER);
  const out = new Uint8Array(header.size);
  let completedChunks = 0, completedBytes = 0, last = -1000, decodeMs = 0;
  send({ type: 'progress', stage, progress: 0, totalChunks: model.meta.n_chunks, totalBytes: header.size });
  for (const segment of header.model.segments) {
    const stream = payload.subarray(segment.offset, segment.offset + segment.length);
    let chunkStarted = performance.now();
    for (const { chunk, bytes } of D.decodeSegmentChunks(model, segment, stream)) {
      decodeMs += performance.now() - chunkStarted;
      out.set(bytes, chunk * model.meta.chunk_len);
      completedChunks++; completedBytes += bytes.length;
      if (watch) {
        // One chunk in flight. The reader acknowledges after displaying it;
        // pausing withholds that acknowledgement and really stops further decoding.
        const ready = new Promise(resolve => { nextChunk = { chunk, resolve }; });
        send({ type: 'chunk', chunk, totalChunks: model.meta.n_chunks, completedBytes,
          totalBytes: header.size, decodeMs, buffer: bytes.buffer }, [bytes.buffer]);
        await ready;
      }
      if (performance.now() - last >= 100 || completedChunks === model.meta.n_chunks) {
        send({ type: 'progress', stage, progress: completedBytes / header.size,
          completedBytes, totalBytes: header.size, completedChunks, totalChunks: model.meta.n_chunks });
        last = performance.now();
        await yieldTurn();
      }
      chunkStarted = performance.now();
    }
  }
  return out;
}

async function run({ action, file, buffer, name, watch = false }) {
  const started = performance.now();
  send({ type: 'progress', stage: 'reading', progress: 0 });
  if (action === 'encode' && file?.size > CHUNK_LENGTH * MAX_CHUNKS) {
    throw new Error('This file exceeds the current archive format’s chunk-address space. Choose an excerpt.');
  }
  if (action === 'decode' && file) {
    const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (prefix.length < 12 || A.MAGIC.some((byte, index) => byte !== prefix[index])) throw new Error('This is not a Neuralzip model archive (.nzip).');
    const length = new DataView(prefix.buffer).getUint32(8, true);
    if (!length || length > A.MAX_HEADER || length + 12 > file.size) throw new Error('Invalid or truncated archive header.');
    let header;
    try { header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.slice(12, 12 + length).arrayBuffer())); }
    catch { throw new Error('The archive header is damaged.'); }
    A.validate(header, file.size - 12 - length, MAX_BUFFER);
  }
  const input = new Uint8Array(file ? await file.arrayBuffer() : buffer);
  if (action === 'decode') {
    const { header, payload } = A.parseRaw(input, MAX_BUFFER);
    send({ type: 'metadata', header: { name: header.name, size: header.size, codec: header.codec,
      totalChunks: header.model?.meta.n_chunks || 0 } });
    const restored = header.size === 0 ? new Uint8Array(0) : await restoreNeural(header, payload, 'decoding', watch);
    send({ type: 'progress', stage: 'verifying', progress: 0 });
    if (await digest(restored) !== header.sha256) throw new Error('Checksum mismatch. This archive could not be restored safely.');
    send({ type: 'result', action, name: header.name, method: header.codec, originalBytes: restored.length,
      archiveBytes: input.length, sha256: header.sha256, verified: true,
      seconds: (performance.now() - started) / 1000, buffer: restored.buffer }, [restored.buffer]);
    return;
  }
  if (action !== 'encode') throw new Error('Choose Encode or Decode.');
  if (Math.ceil(input.length / CHUNK_LENGTH) > MAX_CHUNKS) throw new Error('This file exceeds the archive format’s chunk-address space. Choose an excerpt.');
  await validateText(input);
  const header = { format: 'neurzip/1', codec: 'neural', name: name || file.name,
    size: input.length, sha256: await digest(input) };
  let archive, weightsBytes = 0, streamBytes = 0;
  if (!input.length) {
    archive = A.raw({ ...header, model: null }, new Uint8Array(0), MAX_BUFFER);
  } else {
    send({ type: 'progress', stage: 'preparing', progress: 0 });
    const { train } = await import('./neural.js');
    const pkg = await train(input, event => send({ type: 'progress', ...event }));
    pkg.meta.sha256 = header.sha256;
    const model = D.buildModel(pkg, D.decodeBlobs(pkg));
    // Small inputs need one stream, not dozens of independent stream headers.
    const segments = Math.min(32, Math.max(1, Math.ceil(input.length / 65536)));
    const plan = D.segmentPlan(pkg.meta.n_chunks, Math.min(segments, pkg.meta.n_chunks)), streams = [];
    let lastProgress = -1000;
    for (const segment of plan) {
      streams.push({ ...segment, bytes: D.encodeSegment(model, input, segment.first, segment.count, chunk => {
        if (performance.now() - lastProgress >= 100 || chunk + 1 === pkg.meta.n_chunks) {
          send({ type: 'progress', stage: 'encoding', progress: (chunk + 1) / pkg.meta.n_chunks,
            completedChunks: chunk + 1, totalChunks: pkg.meta.n_chunks,
            completedBytes: Math.min(input.length, (chunk + 1) * pkg.meta.chunk_len), totalBytes: input.length });
          lastProgress = performance.now();
        }
      }) });
      await yieldTurn();
    }
    const { payload, model: manifest } = neuralPayload(pkg, streams);
    const neuralHeader = { ...header, model: manifest };
    archive = A.raw(neuralHeader, payload, MAX_BUFFER);
    weightsBytes = Object.values(manifest.blobs).reduce((n, b) => n + b.length, 0);
    streamBytes = manifest.segments.reduce((n, b) => n + b.length, 0);
    const restored = await restoreNeural(neuralHeader, payload, 'verifying');
    if (restored.length !== input.length || !restored.every((byte, index) => byte === input[index]) || await digest(restored) !== header.sha256) {
      throw new Error('Verification failed. No archive was saved.');
    }
  }
  send({ type: 'result', action, name: header.name + '.nzip', method: 'neural', originalBytes: input.length,
    archiveBytes: archive.length, weightsBytes, streamBytes, settingsBytes: archive.length - weightsBytes - streamBytes,
    sha256: header.sha256, verified: true, seconds: (performance.now() - started) / 1000,
    buffer: archive.buffer }, [archive.buffer]);
}

self.onmessage = ({ data }) => {
  if (data.action === 'next') {
    if (nextChunk && data.chunk === nextChunk.chunk) { const { resolve } = nextChunk; nextChunk = null; resolve(); }
    return;
  }
  if (data.action === 'cancel') { self.close(); return; }
  run(data).catch(error => {
    const message = error instanceof RangeError ? 'Your browser could not allocate enough memory. Try a smaller excerpt.' : error.message;
    send({ type: 'error', message: message || 'The job could not finish. Try a smaller excerpt.' });
  });
};
