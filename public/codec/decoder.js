/* decoder.js: the model from model.py in plain JavaScript, plus an arithmetic coder.
 *
 * Deterministic: everything is computed from +, -, *, /, comparisons and rounding,
 * which IEEE 754 defines exactly, in a fixed order. exp, log, sin, cos and 1/sqrt
 * are built here from those operations instead of Math.exp and friends, whose
 * last bits can differ between browsers. So every JavaScript engine on every
 * machine computes bit-identical probabilities, which arithmetic-coded streams need.
 *
 * Runs in a browser page, a Web Worker, Node, Bun, Deno and Safari's jsc shell.
 * Exposes BookDecoder (browser, jsc) or module.exports (Node, Bun).
 */
(function (root) {
  "use strict";
  const KEY = 256;     // token id of the key marker
  const KEY_LEN = 4;   // [KEY, book, chunk_hi, chunk_lo]
  const N_BYTES = 256; // the model may only output byte tokens

  // ---------------------------------------------------------------- deterministic math
  const DV = new DataView(new ArrayBuffer(8));
  const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10;
  const INV_LN2 = 1.44269504088896338700e+00;
  const PIO2_HI = 1.57079632673412561417e+00, PIO2_LO = 6.07710050650619224932e-11;
  const INV_PIO2 = 6.36619772367581382433e-01;
  const INV_FACT = [];
  for (let n = 0, f = 1; n <= 17; n++) { if (n) f *= n; INV_FACT.push(1 / f); }

  function pow2(k) { // 2^k for integer k in [-1022, 1023], built from its bit pattern
    DV.setUint32(0, (k + 1023) << 20);
    DV.setUint32(4, 0);
    return DV.getFloat64(0);
  }
  function exponentOf(x) {
    DV.setFloat64(0, x);
    return ((DV.getUint32(0) >>> 20) & 0x7ff) - 1023;
  }
  function dexp(x) {
    if (x < -700) return 0;
    if (x > 700) x = 700;
    const k = Math.round(x * INV_LN2);
    const r = (x - k * LN2_HI) - k * LN2_LO; // |r| <= 0.35
    let p = INV_FACT[14];
    for (let n = 13; n >= 0; n--) p = p * r + INV_FACT[n];
    return p * pow2(k);
  }
  function dlog(x) { // x > 0, normal
    DV.setFloat64(0, x);
    const hi = DV.getUint32(0);
    let e = ((hi >>> 20) & 0x7ff) - 1023;
    DV.setUint32(0, (hi & 0x000fffff) | 0x3ff00000);
    let m = DV.getFloat64(0); // mantissa in [1, 2)
    if (m > 1.4142135623730951) { m = m / 2; e += 1; }
    const s = (m - 1) / (m + 1), s2 = s * s; // ln m = 2 atanh(s)
    let t = 0;
    for (let n = 31; n >= 1; n -= 2) t = t * s2 + 1 / n;
    return 2 * s * t + e * LN2_HI + e * LN2_LO;
  }
  function dsincos(a) { // returns [sin a, cos a]
    const k = Math.round(a * INV_PIO2);
    const r = (a - k * PIO2_HI) - k * PIO2_LO, r2 = r * r; // |r| <= pi/4
    let s = 0, c = 0;
    for (let j = 7; j >= 0; j--) s = s * r2 + (j % 2 ? -INV_FACT[2 * j + 1] : INV_FACT[2 * j + 1]);
    for (let j = 8; j >= 0; j--) c = c * r2 + (j % 2 ? -INV_FACT[2 * j] : INV_FACT[2 * j]);
    s = s * r;
    switch (((k % 4) + 4) % 4) {
      case 0: return [s, c];
      case 1: return [c, -s];
      case 2: return [-s, -c];
      default: return [-c, s];
    }
  }
  function dinvsqrt(x) { // 1 / sqrt(x), x > 0, by Newton's method from an exponent-based guess
    const e = exponentOf(x);
    let y = pow2(-Math.floor(e / 2)) * ((e & 1) ? 0.7071067811865476 : 1) * 0.85;
    for (let i = 0; i < 7; i++) y = y * (1.5 - 0.5 * x * y * y);
    return y;
  }

  // ---------------------------------------------------------------- loading weights
  function base64ToBytes(b64) {
    if (typeof atob === "function") {
      const bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", map = {};
    for (let i = 0; i < 64; i++) map[A[i]] = i;
    const clean = b64.replace(/=+$/, ""), out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let buf = 0, bits = 0, o = 0;
    for (let i = 0; i < clean.length; i++) {
      buf = (buf << 6) | map[clean[i]]; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
    }
    return out;
  }
  const u16 = (b) => new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1);

  // Decode the package's base64 blobs once (they can then be passed to workers).
  function decodeBlobs(pkg) {
    return {
      bf16: pkg.weights_b64 ? u16(base64ToBytes(pkg.weights_b64)) : new Uint16Array(0),
      qdata: pkg.qdata_b64 ? base64ToBytes(pkg.qdata_b64) : new Uint8Array(0),
      scales: pkg.scales_b64 ? u16(base64ToBytes(pkg.scales_b64)) : new Uint16Array(0),
    };
  }
  function bf16(v) { DV.setUint32(0, v << 16); return DV.getFloat32(0); }

  function tensorValues(t, blobs) {
    const out = new Float32Array(t.numel);
    if (!t.kind || t.kind === "bf16") {
      for (let i = 0; i < t.numel; i++) out[i] = bf16(blobs.bf16[t.offset + i]);
      return out;
    }
    const cols = t.shape[1], q8 = t.kind === "q8";
    for (let r = 0; r < t.shape[0]; r++) {
      const s = bf16(blobs.scales[t.scale_offset + r]);
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let q;
        if (q8) { q = blobs.qdata[t.q_offset + i]; if (q > 127) q -= 256; }
        else { const byte = blobs.qdata[t.q_offset + (i >> 1)]; q = ((i & 1) ? byte >> 4 : byte & 15) - 8; }
        out[i] = q * s; // exact, same as PyTorch's float32 product
      }
    }
    return out;
  }

  function buildModel(pkg, blobs) {
    const c = pkg.config, W = {};
    for (const t of pkg.tensors) W[t.name] = tensorValues(t, blobs);
    const D = c.d_model, hd = D / c.n_head, half = hd / 2, T = c.max_len;

    const cos = new Float32Array(T * half), sin = new Float32Array(T * half);
    const lnTheta = dlog(c.rope_theta);
    for (let i = 0; i < half; i++) {
      const inv = Math.fround(dexp(-((2 * i) / hd) * lnTheta));
      for (let p = 0; p < T; p++) {
        const sc = dsincos(Math.fround(p * inv));
        sin[p * half + i] = sc[0];
        cos[p * half + i] = sc[1];
      }
    }

    const layers = [];
    for (let l = 0; l < c.n_layer; l++) {
      const g = (n) => W[`blocks.${l}.${n}.weight`];
      layers.push({
        attn_norm: g("attn_norm"), q: g("attn.q"), k: g("attn.k"), v: g("attn.v"), o: g("attn.o"),
        q_norm: g("attn.q_norm"), k_norm: g("attn.k_norm"),
        mlp_norm: g("mlp_norm"), gate: g("mlp.gate"), up: g("mlp.up"), down: g("mlp.down"),
      });
    }
    const fixes = new Map();
    for (const [chunk, offset, byte] of pkg.fixes || []) fixes.set(chunk * 65536 + offset, byte);

    return {
      config: c, meta: pkg.meta, embed: W["embed.weight"], norm: W["norm.weight"], layers, cos, sin, fixes,
      hd, half, attnScale: dinvsqrt(hd), n_params: pkg.tensors.reduce((s, t) => s + t.numel, 0),
      kc: layers.map(() => new Float32Array(T * D)), vc: layers.map(() => new Float32Array(T * D)),
      x: new Float32Array(D), h: new Float32Array(D), q: new Float32Array(D),
      att: new Float32Array(D), tmp: new Float32Array(D),
      g: new Float32Array(c.d_ff), u: new Float32Array(c.d_ff),
      scores: new Float64Array(T), logits: new Float32Array(c.vocab_size),
      ex: new Float64Array(N_BYTES), cum: new Float64Array(N_BYTES),
    };
  }

  // ---------------------------------------------------------------- the network
  function matvec(out, W, x, rows, cols) { // out = W x, W row-major [rows, cols] (PyTorch Linear layout)
    for (let r = 0; r < rows; r++) {
      let acc = 0;
      const base = r * cols;
      for (let i = 0; i < cols; i++) acc += W[base + i] * x[i];
      out[r] = acc;
    }
  }
  function rmsnorm(out, x, w, off, n) { // out[off..off+n) = RMSNorm(x[off..off+n)) * w   (out may be x)
    let ss = 0;
    for (let i = 0; i < n; i++) ss += x[off + i] * x[off + i];
    const r = dinvsqrt(ss / n + 1e-6);
    for (let i = 0; i < n; i++) out[off + i] = x[off + i] * r * w[i];
  }
  function rope(v, off, p, m) { // rotate channel pairs (i, i + half) of one head
    const half = m.half;
    for (let i = 0; i < half; i++) {
      const c = m.cos[p * half + i], s = m.sin[p * half + i];
      const a = v[off + i], b = v[off + i + half];
      v[off + i] = a * c - b * s;
      v[off + i + half] = a * s + b * c;
    }
  }

  // Feed one token at position p (keys and values are kept in the cache). Returns logits if asked.
  function step(m, token, p, wantLogits) {
    const c = m.config, D = c.d_model, H = c.n_head, hd = m.hd, F = c.d_ff;
    const { x, h, q, att, tmp, g, u, scores } = m;
    x.set(m.embed.subarray(token * D, token * D + D));
    for (let l = 0; l < c.n_layer; l++) {
      const L = m.layers[l], kc = m.kc[l], vc = m.vc[l];
      rmsnorm(h, x, L.attn_norm, 0, D);
      matvec(q, L.q, h, D, D);
      const kp = kc.subarray(p * D, p * D + D), vp = vc.subarray(p * D, p * D + D);
      matvec(kp, L.k, h, D, D);
      matvec(vp, L.v, h, D, D);
      for (let hh = 0; hh < H; hh++) {
        const o = hh * hd;
        rmsnorm(q, q, L.q_norm, o, hd); rope(q, o, p, m);    // QK-norm, then RoPE
        rmsnorm(kp, kp, L.k_norm, o, hd); rope(kp, o, p, m);
        let mx = -Infinity;
        for (let t = 0; t <= p; t++) {                       // causal: positions 0..p only
          let s = 0;
          const kb = t * D + o;
          for (let i = 0; i < hd; i++) s += q[o + i] * kc[kb + i];
          s *= m.attnScale;
          scores[t] = s;
          if (s > mx) mx = s;
        }
        let sum = 0;
        for (let t = 0; t <= p; t++) { const e = dexp(scores[t] - mx); scores[t] = e; sum += e; }
        for (let i = 0; i < hd; i++) att[o + i] = 0;
        for (let t = 0; t <= p; t++) {
          const w = scores[t] / sum, vb = t * D + o;
          for (let i = 0; i < hd; i++) att[o + i] += w * vc[vb + i];
        }
      }
      matvec(tmp, L.o, att, D, D);
      for (let i = 0; i < D; i++) x[i] += tmp[i];
      rmsnorm(h, x, L.mlp_norm, 0, D);
      matvec(g, L.gate, h, F, D);
      matvec(u, L.up, h, F, D);
      for (let i = 0; i < F; i++) { const z = g[i]; g[i] = (z / (1 + dexp(-z))) * u[i]; }
      matvec(tmp, L.down, g, D, F);
      for (let i = 0; i < D; i++) x[i] += tmp[i];
    }
    if (!wantLogits) return null;
    rmsnorm(h, x, m.norm, 0, D);
    matvec(m.logits, m.embed, h, c.vocab_size, D); // output layer reuses the embedding table
    return m.logits;
  }

  function chunkLength(m, idx) {
    return Math.min(m.meta.chunk_len, m.meta.total_len - idx * m.meta.chunk_len);
  }

  // Probabilities for the next byte -> cumulative integer frequencies (every byte keeps at least 1).
  const AC_BITS = 20;
  function cumFreqs(m, logits) {
    let best = 0;
    for (let b = 1; b < N_BYTES; b++) if (logits[b] > logits[best]) best = b;
    let sum = 0;
    for (let b = 0; b < N_BYTES; b++) { m.ex[b] = dexp(logits[b] - logits[best]); sum += m.ex[b]; }
    let acc = 0;
    for (let b = 0; b < N_BYTES; b++) { acc += Math.floor((m.ex[b] / sum) * 1048576) + 1; m.cum[b] = acc; }
    return { best, p: m.ex[best] / sum };
  }

  // Walk one chunk from its key: at each byte, compute the frequency table, let pick() choose the byte.
  function walkChunk(m, idx, pick) {
    const key = [KEY, m.meta.book_id + Math.floor(idx / 65536), (idx >> 8) & 255, idx & 255];
    const n = chunkLength(m, idx), out = new Uint8Array(n);
    let logits;
    for (let p = 0; p < KEY_LEN; p++) logits = step(m, key[p], p, p === KEY_LEN - 1);
    for (let j = 0; j < n; j++) {
      const top = cumFreqs(m, logits);
      out[j] = pick(j, m.cum, top);
      if (j < n - 1) logits = step(m, out[j], KEY_LEN + j, true);
    }
    return out;
  }

  // Greedy: the model writes the chunk alone (stored fixes override its guess).
  function* writeChunk(m, idx) {
    const key = [KEY, m.meta.book_id + Math.floor(idx / 65536), (idx >> 8) & 255, idx & 255];
    const n = chunkLength(m, idx);
    let logits;
    for (let p = 0; p < KEY_LEN; p++) logits = step(m, key[p], p, p === KEY_LEN - 1);
    for (let j = 0; j < n; j++) {
      const top = cumFreqs(m, logits);
      const fix = m.fixes.get(idx * 65536 + j);
      const byte = fix === undefined ? top.best : fix;
      yield { j, byte, guess: top.best, p: top.p, fixed: fix !== undefined };
      if (j < n - 1) logits = step(m, byte, KEY_LEN + j, true);
    }
  }
  function decodeChunk(m, idx) {
    const n = chunkLength(m, idx), bytes = new Uint8Array(n), conf = new Float32Array(n);
    for (const s of writeChunk(m, idx)) { bytes[s.j] = s.byte; conf[s.j] = s.p; }
    return { bytes, conf };
  }

  // ---------------------------------------------------------------- arithmetic coding
  // 32-bit integer coder in plain Number arithmetic (all products stay below 2^53, so exact).
  const HALF = 2147483648, QUARTER = 1073741824, TOP = 4294967295;
  function floorDiv(a, b) {
    let q = Math.floor(a / b);
    while (q * b > a) q--;
    while ((q + 1) * b <= a) q++;
    return q;
  }
  function Encoder() { this.low = 0; this.high = TOP; this.pending = 0; this.out = []; this.cur = 0; this.n = 0; }
  Encoder.prototype.bit = function (b) {
    this.cur = (this.cur << 1) | b;
    if (++this.n === 8) { this.out.push(this.cur); this.cur = 0; this.n = 0; }
  };
  Encoder.prototype.put = function (b) { this.bit(b); for (; this.pending > 0; this.pending--) this.bit(b ^ 1); };
  Encoder.prototype.write = function (cum, sym) {
    const total = cum[N_BYTES - 1], span = this.high - this.low + 1, lo = sym ? cum[sym - 1] : 0;
    this.high = this.low + floorDiv(cum[sym] * span, total) - 1;
    this.low = this.low + floorDiv(lo * span, total);
    for (;;) {
      if (this.high < HALF) this.put(0);
      else if (this.low >= HALF) { this.put(1); this.low -= HALF; this.high -= HALF; }
      else if (this.low >= QUARTER && this.high < 3 * QUARTER) { this.pending++; this.low -= QUARTER; this.high -= QUARTER; }
      else break;
      this.low = this.low * 2; this.high = this.high * 2 + 1;
    }
  };
  Encoder.prototype.finish = function () {
    this.pending++;
    this.put(this.low < QUARTER ? 0 : 1);
    if (this.n) { this.out.push(this.cur << (8 - this.n)); this.cur = 0; this.n = 0; }
    return Uint8Array.from(this.out);
  };
  function Decoder(bytes) {
    this.bytes = bytes; this.pos = 0; this.low = 0; this.high = TOP; this.code = 0;
    for (let i = 0; i < 32; i++) this.code = this.code * 2 + this.bit();
  }
  Decoder.prototype.bit = function () {
    const i = this.pos >> 3, b = i < this.bytes.length ? (this.bytes[i] >> (7 - (this.pos & 7))) & 1 : 0;
    this.pos++;
    return b;
  };
  Decoder.prototype.read = function (cum) {
    const total = cum[N_BYTES - 1], span = this.high - this.low + 1;
    const value = floorDiv((this.code - this.low + 1) * total - 1, span);
    let a = 0, z = N_BYTES - 1;
    while (a < z) { const mid = (a + z) >> 1; if (cum[mid] > value) z = mid; else a = mid + 1; }
    const sym = a, lo = sym ? cum[sym - 1] : 0;
    this.high = this.low + floorDiv(cum[sym] * span, total) - 1;
    this.low = this.low + floorDiv(lo * span, total);
    for (;;) {
      if (this.high < HALF) { /* top bit 0 */ }
      else if (this.low >= HALF) { this.low -= HALF; this.high -= HALF; this.code -= HALF; }
      else if (this.low >= QUARTER && this.high < 3 * QUARTER) { this.low -= QUARTER; this.high -= QUARTER; this.code -= QUARTER; }
      else break;
      this.low = this.low * 2; this.high = this.high * 2 + 1; this.code = this.code * 2 + this.bit();
    }
    return sym;
  };

  // Encode chunks first .. first+count-1 into one stream.
  function encodeSegment(m, text, first, count, onChunk) {
    const enc = new Encoder(), L = m.meta.chunk_len;
    for (let c = first; c < first + count; c++) {
      walkChunk(m, c, (j, cum) => { const b = text[c * L + j]; enc.write(cum, b); return b; });
      if (onChunk) onChunk(c);
    }
    return enc.finish();
  }
  // Split the book into independent segments (so they can be coded in parallel).
  function segmentPlan(nChunks, nSegments) {
    const per = Math.ceil(nChunks / nSegments), plan = [];
    for (let first = 0; first < nChunks; first += per) plan.push({ first, count: Math.min(per, nChunks - first) });
    return plan;
  }
  function encodeBook(m, text, nSegments) {
    return segmentPlan(m.meta.n_chunks, nSegments).map((s) => ({ ...s, bytes: encodeSegment(m, text, s.first, s.count) }));
  }
  // Decode one segment; onChunk(idx, bytes) is called as each chunk is finished.
  function decodeSegment(m, seg, streamBytes, onChunk) {
    const dec = new Decoder(streamBytes);
    for (let c = seg.first; c < seg.first + seg.count; c++) {
      onChunk(c, walkChunk(m, c, (j, cum) => dec.read(cum)));
    }
  }

  // ---------------------------------------------------------------- SHA-256
  function sha256Hex(bytes) {
    const primes = [];
    for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
    const frac = (x) => ((x - Math.floor(x)) * 4294967296) >>> 0;
    const K = primes.map((p) => frac(Math.cbrt(p)));
    const H = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));
    const ror = (v, n) => (v >>> n) | (v << (32 - n));
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
    dv.setUint32(total - 4, (len * 8) >>> 0);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ror(a, 7) ^ ror(a, 18) ^ (a >>> 3), s1 = ror(b, 17) ^ ror(b, 19) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }

  const api = {
    KEY, KEY_LEN, AC_BITS, base64ToBytes, decodeBlobs, buildModel, step, writeChunk, decodeChunk, chunkLength,
    encodeBook, encodeSegment, segmentPlan, decodeSegment, Encoder, Decoder, sha256Hex,
    math: { dexp, dlog, dsincos, dinvsqrt },
  };
  root.BookDecoder = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
