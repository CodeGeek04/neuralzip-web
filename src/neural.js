// Loaded on demand inside a worker. Training stays on the visitor's device.
import * as tf from '@tensorflow/tfjs';
import { CHECK_EVERY, ChunkSampler, evaluationChunks, trainingConfig, TrainingConvergence } from '../lib/training-policy.js';
import { archiveWeights, bf16, bfValue, roundEven } from './training-math.js';
const concat = parts => {
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let pos = 0; for (const x of parts) { out.set(x, pos); pos += x.length; } return out;
};

export async function train(bytes, onProgress) {
  onProgress({ stage: 'preparing', progress: 0 });
  try { await tf.setBackend('webgl'); } catch { await tf.setBackend('cpu'); }
  await tf.ready();
  const config = trainingConfig(bytes.length);
  const { d_model: D, n_head: H, d_ff: F, n_layer: LAYERS } = config;
  const CHUNK = config.max_len - 4, T = CHUNK + 3;
  const vars = {}, tensors = [], qParts = [], scaleParts = [], bfParts = [];
  let seed = 1;
  const variable = (name, shape, norm = false, residual = false) => {
    const initial = norm ? tf.ones(shape) : tf.randomNormal(shape, 0, 0.02 / (residual ? Math.sqrt(2 * LAYERS) : 1), 'float32', seed++);
    vars[name] = tf.variable(initial); initial.dispose();
  };
  variable('embed.weight', [257, D]);
  for (let i = 0; i < LAYERS; i++) {
    const p = `blocks.${i}.`;
    for (const n of ['attn_norm', 'mlp_norm']) variable(p + n + '.weight', [D], true);
    for (const n of ['q', 'k', 'v', 'o']) variable(p + 'attn.' + n + '.weight', [D, D], false, n === 'o');
    for (const n of ['q_norm', 'k_norm']) variable(p + 'attn.' + n + '.weight', [D / H], true);
    for (const n of ['gate', 'up']) variable(p + 'mlp.' + n + '.weight', [F, D]);
    variable(p + 'mlp.down.weight', [D, F], false, true);
  }
  variable('norm.weight', [D], true);
  const half = D / H / 2, cos = [], sin = [];
  for (let t = 0; t < T; t++) for (let j = 0; j < half; j++) {
    const a = t / 10000 ** (2 * j / (D / H)); cos.push(Math.cos(a)); sin.push(Math.sin(a));
  }
  const cosine = tf.tensor4d(cos, [1, 1, T, half]), sine = tf.tensor4d(sin, [1, 1, T, half]);
  const mask = tf.tidy(() => tf.ones([T, T]).sub(tf.linalg.bandPart(tf.ones([T, T]), -1, 0)).mul(-1e9));
  const rms = (x, w) => x.mul(tf.rsqrt(x.square().mean(-1, true).add(1e-6))).mul(w);
  const linear = (x, w) => tf.matMul(x.reshape([-1, w.shape[1]]), w, false, true).reshape([...x.shape.slice(0, -1), w.shape[0]]);
  const rotary = x => {
    const [a, b] = tf.split(x, 2, -1);
    return tf.concat([a.mul(cosine).sub(b.mul(sine)), a.mul(sine).add(b.mul(cosine))], -1);
  };
  const forward = (x, storedWeights) => {
    const batch = x.shape[0];
    const weights = storedWeights ? Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, archiveWeights(value)])) : vars;
    let h = tf.gather(weights['embed.weight'], x);
    const heads = v => v.reshape([batch, T, H, D / H]).transpose([0, 2, 1, 3]);
    for (let i = 0; i < LAYERS; i++) {
      const p = `blocks.${i}.`, get = n => weights[p + n + '.weight'];
      const n = rms(h, get('attn_norm'));
      const q = rotary(rms(heads(linear(n, get('attn.q'))), get('attn.q_norm')));
      const k = rotary(rms(heads(linear(n, get('attn.k'))), get('attn.k_norm')));
      const v = heads(linear(n, get('attn.v')));
      const scores = tf.matMul(q, k, false, true).div(Math.sqrt(D / H)).add(mask);
      const attention = tf.matMul(tf.softmax(scores), v).transpose([0, 2, 1, 3]).reshape([batch, T, D]);
      h = h.add(linear(attention, get('attn.o')));
      const normalized = rms(h, get('mlp_norm'));
      const g = linear(normalized, get('mlp.gate'));
      h = h.add(linear(g.mul(tf.sigmoid(g)).mul(linear(normalized, get('mlp.up'))), get('mlp.down')));
    }
    return linear(rms(h, weights['norm.weight']), weights['embed.weight']);
  };
  const nChunks = Math.ceil(bytes.length / CHUNK), batch = Math.min(8, nChunks);
  const sampler = new ChunkSampler(nChunks), checks = evaluationChunks(nChunks);
  let opt = tf.train.adam(0.003, 0.9, 0.95);
  const started = performance.now();
  let steps = 0, lossValue = 8, last = -1000, bestWeights = null, bestScore = Infinity;
  const fixedBytes = Object.values(vars).reduce((size, value) => size + (value.rank === 2 ? value.size + value.shape[0] * 2 : value.size * 2), 0);
  const policy = { inputBytes: bytes.length, fixedBytes, requiredChunks: Math.min(2 * nChunks, 4096) };
  let convergence = new TrainingConvergence(policy), quantized = false, phaseStartSteps = 0, phaseStartSeen = 0, seenChunks = 0;
  let finished = false;
  const makeBatch = chunks => {
    const inputs = new Int32Array(chunks.length * T), targets = new Int32Array(chunks.length * T), weights = new Float32Array(chunks.length * T);
    let tokenCount = 0;
    for (let b = 0; b < chunks.length; b++) {
      const c = chunks[b], length = Math.min(CHUNK, bytes.length - c * CHUNK);
      inputs.set([256, c >>> 16, (c >>> 8) & 255, c & 255], b * T);
      for (let j = 0; j < length; j++) {
        targets[b * T + 3 + j] = bytes[c * CHUNK + j]; weights[b * T + 3 + j] = 1;
        if (j < length - 1) inputs[b * T + 4 + j] = bytes[c * CHUNK + j];
      }
      tokenCount += length;
    }
    return { inputs, targets, weights, tokenCount, count: chunks.length };
  };
  const objective = (sample, storedWeights) => tf.tidy(() => {
    const x = tf.tensor2d(sample.inputs, [sample.count, T], 'int32');
    // The decoder codes 256 byte symbols. KEY is an input marker, never an output.
    const logits = forward(x, storedWeights).reshape([-1, 257]).slice([0, 0], [-1, 256]);
    const labels = tf.oneHot(tf.tensor1d(sample.targets, 'int32'), 256);
    return tf.losses.softmaxCrossEntropy(labels, logits, tf.tensor1d(sample.weights));
  });
  const evaluation = [];
  for (let i = 0; i < checks.length; i += batch) evaluation.push(makeBatch(checks.slice(i, i + batch)));
  try {
    do {
      const sample = makeBatch(sampler.next(batch));
      seenChunks += sample.count;
      const loss = tf.tidy(() => {
        const { value, grads } = tf.variableGrads(() => objective(sample, quantized), Object.values(vars));
        const norm = tf.addN(Object.values(grads).map(gradient => gradient.square().sum())).sqrt().maximum(1);
        opt.applyGradients(Object.fromEntries(Object.entries(grads).map(([name, gradient]) => [name, gradient.div(norm)])));
        return value;
      });
      lossValue = (await loss.data())[0] / Math.LN2; loss.dispose(); steps++;
      if (steps % CHECK_EVERY === 0) {
        let totalLoss = 0, totalTokens = 0;
        for (const sample of evaluation) {
          const score = objective(sample, true);
          totalLoss += (await score.data())[0] * sample.tokenCount; totalTokens += sample.tokenCount;
          score.dispose();
        }
        const measured = totalLoss / totalTokens / Math.LN2;
        const status = convergence.observe(measured, { steps: steps - phaseStartSteps, seenChunks: seenChunks - phaseStartSeen });
        if (measured < bestScore) {
          bestScore = measured;
          if (bestWeights) Object.values(bestWeights).forEach(tensor => tensor.dispose());
          bestWeights = Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, value.clone()]));
        }
        if (status.done && !quantized) {
          // Refine using the stored weights, as the Python trainer does. The
          // phase transition follows convergence rather than a time budget.
          quantized = true; phaseStartSteps = steps; phaseStartSeen = seenChunks;
          convergence = new TrainingConvergence({ ...policy, minSteps: 128 });
          opt.dispose(); opt = tf.train.adam(0.0005, 0.9, 0.95);
        } else finished = status.done;
      }
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed - last > 0.4 || finished) {
        onProgress({ stage: 'training', elapsedSeconds: elapsed, steps, epochs: sampler.epochs,
          phase: quantized ? 'refining' : 'learning', bitsPerByte: lossValue, storedBitsPerByte: bestScore });
        last = elapsed;
      }
      await tf.nextFrame();
    } while (!finished);
    if (bestWeights) for (const [name, value] of Object.entries(vars)) value.assign(bestWeights[name]);
    let qOffset = 0, scaleOffset = 0, bfOffset = 0;
    for (const [name, variable] of Object.entries(vars)) {
      const data = await variable.data(), shape = variable.shape, numel = data.length;
      if (shape.length === 1) {
        const output = new Uint8Array(numel * 2), view = new DataView(output.buffer);
        data.forEach((x, i) => view.setUint16(i * 2, bf16(x), true)); bfParts.push(output);
        tensors.push({ name, kind: 'bf16', shape, numel, offset: bfOffset }); bfOffset += numel;
      } else {
        const q = new Uint8Array(numel), scales = new Uint8Array(shape[0] * 2), view = new DataView(scales.buffer);
        for (let r = 0; r < shape[0]; r++) {
          let max = 1e-8;
          for (let c = 0; c < shape[1]; c++) max = Math.max(max, Math.abs(data[r * shape[1] + c]));
          const scaleBits = bf16(max / 127), scale = bfValue(scaleBits);
          view.setUint16(r * 2, scaleBits, true);
          for (let c = 0; c < shape[1]; c++) q[r * shape[1] + c] = Math.max(-127, Math.min(127, roundEven(data[r * shape[1] + c] / scale))) & 255;
        }
        qParts.push(q); scaleParts.push(scales);
        tensors.push({ name, kind: 'q8', shape, numel, q_offset: qOffset, scale_offset: scaleOffset });
        qOffset += numel; scaleOffset += shape[0];
      }
    }
    const b64 = globalThis.LCPArchive.base64;
    return { config,
      meta: { book_id: 0, chunk_len: CHUNK, n_chunks: nChunks, total_len: bytes.length, sha256: '' },
      tensors, fixes: [], weights_b64: b64(concat(bfParts)), qdata_b64: b64(concat(qParts)), scales_b64: b64(concat(scaleParts)) };
  } finally {
    if (bestWeights) Object.values(bestWeights).forEach(tensor => tensor.dispose());
    opt.dispose(); Object.values(vars).forEach(v => v.dispose());
    cosine.dispose(); sine.dispose(); mask.dispose();
  }
}
