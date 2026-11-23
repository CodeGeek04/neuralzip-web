/* neuralzip v1. Shared validation and neural codec for Python and browsers. */
(function (root) {
  "use strict";
  const MAGIC = [78, 69, 85, 82, 90, 73, 80, 49];
  const MAX_HEADER = 1 << 20;
  const MAX_MODEL = 20_000_000;
  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  function fail(message) { throw new Error(message); }
  function base64(bytes) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
      const n = a * 65536 + b * 256 + c;
      out += alphabet[n >>> 18] + alphabet[(n >>> 12) & 63] +
        (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : "=") +
        (i + 2 < bytes.length ? alphabet[n & 63] : "=");
    }
    return out;
  }
  function validate(header, payloadLength, maxOutput = 16 << 20) {
    if (!header || header.format !== "neurzip/1") fail("Unsupported archive version.");
    if (header.codec !== "neural") fail("Unsupported compression method.");
    if (!integer(header.size, 0, maxOutput)) fail("The restored file exceeds the allowed size.");
    if (typeof header.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(header.sha256)) fail("Invalid archive checksum.");
    if (typeof header.name !== "string" || header.name.length > 255 || !header.name ||
        /[\\/:<>"|?*\x00-\x1f]/.test(header.name) || [".", ".."].includes(header.name)) fail("Invalid archived filename.");
    if (header.size === 0) {
      if (payloadLength || header.model !== null) fail("Invalid empty model archive.");
      return header;
    }
    const p = header.model, c = p?.config, m = p?.meta;
    if (!c || !m || !integer(header.size, 1, maxOutput)) fail("Invalid neural archive size.");
    if (c.vocab_size !== 257 || !integer(c.n_layer, 1, 12) || !integer(c.d_model, 8, 512) ||
        !integer(c.n_head, 1, 16) || c.d_model % c.n_head || (c.d_model / c.n_head) % 2 ||
        !integer(c.d_ff, 8, 2048) || !integer(c.max_len, 8, 1024) || c.rope_theta !== 10000) fail("Unsupported model configuration.");
    if (!integer(m.chunk_len, 4, 1020) || c.max_len !== m.chunk_len + 4 || m.book_id !== 0 ||
        m.total_len !== header.size || !integer(m.n_chunks, 1, 16777216) || m.n_chunks !== Math.ceil(header.size / m.chunk_len) ||
        m.sha256 !== header.sha256) fail("Inconsistent model metadata.");
    if (!p.blobs || !Array.isArray(p.tensors) || !Array.isArray(p.segments) || !p.segments.length ||
        p.segments.length > 256 || p.bits !== 20) fail("Invalid neural payload.");
    let cursor = 0;
    const checkRange = (s) => {
      if (!s || s.offset !== cursor || !integer(s.length, 0, payloadLength - cursor)) fail("Invalid or truncated payload range.");
      cursor += s.length;
    };
    for (const key of ["weights_b64", "qdata_b64", "scales_b64"]) checkRange(p.blobs[key]);
    let first = 0;
    for (const s of p.segments) {
      if (s.first !== first || !integer(s.count, 1, m.n_chunks - first) || s.length < 1) fail("Invalid stream layout.");
      first += s.count; checkRange(s);
    }
    if (first !== m.n_chunks || cursor !== payloadLength) fail("Incomplete neural streams.");
    const d = c.d_model, f = c.d_ff, h = d / c.n_head;
    const expected = { "embed.weight": [257, d], "norm.weight": [d] };
    for (let i = 0; i < c.n_layer; i++) {
      const prefix = `blocks.${i}.`;
      for (const n of ["attn_norm", "mlp_norm"]) expected[prefix + n + ".weight"] = [d];
      for (const n of ["q", "k", "v", "o"]) expected[prefix + "attn." + n + ".weight"] = [d, d];
      for (const n of ["q_norm", "k_norm"]) expected[prefix + "attn." + n + ".weight"] = [h];
      for (const n of ["gate", "up"]) expected[prefix + "mlp." + n + ".weight"] = [f, d];
      expected[prefix + "mlp.down.weight"] = [d, f];
    }
    let total = 0, bf = 0, q = 0, sc = 0;
    const seen = new Set();
    for (const t of p.tensors) {
      if (!t || !Object.hasOwn(expected, t.name) || seen.has(t.name) ||
          JSON.stringify(t.shape) !== JSON.stringify(expected[t.name])) fail("Invalid model tensor.");
      seen.add(t.name);
      const n = t.shape.reduce((a, b) => a * b, 1); total += n;
      if (total > MAX_MODEL || t.numel !== n) fail("Model is too large or inconsistent.");
      if (t.kind === "bf16") {
        if (t.offset !== bf) fail("Invalid tensor offset.");
        bf += n;
      } else if (["q4", "q8"].includes(t.kind) && t.shape.length === 2) {
        if (t.q_offset !== q || t.scale_offset !== sc) fail("Invalid quantized tensor offset.");
        q += t.kind === "q8" ? n : Math.ceil(n / 2); sc += t.shape[0];
      } else fail("Unsupported tensor representation.");
    }
    if (seen.size !== Object.keys(expected).length || p.blobs.weights_b64.length !== bf * 2 ||
        p.blobs.qdata_b64.length !== q || p.blobs.scales_b64.length !== sc * 2) fail("Missing model weights.");
    return header;
  }
  function parseRaw(bytes, maxOutput = 16 << 20) {
    if (bytes.length < 12 || MAGIC.some((v, i) => bytes[i] !== v)) fail("This is not a Neuralzip model archive (.nzip).");
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
    if (!n || n > MAX_HEADER || 12 + n > bytes.length) fail("Invalid or truncated archive header.");
    let header;
    try { header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(12, 12 + n))); }
    catch { fail("The archive header is damaged."); }
    const payload = bytes.subarray(12 + n);
    validate(header, payload.length, maxOutput);
    return { header, payload };
  }
  function raw(header, payload, maxOutput = 16 << 20) {
    validate(header, payload.length, maxOutput);
    const json = new TextEncoder().encode(JSON.stringify(header));
    if (json.length > MAX_HEADER) fail("Archive header is too large.");
    const out = new Uint8Array(12 + json.length + payload.length);
    out.set(MAGIC); new DataView(out.buffer).setUint32(8, json.length, true);
    out.set(json, 12); out.set(payload, 12 + json.length); return out;
  }
  function neuralModel(header, payload, maxOutput = 16 << 20) {
    validate(header, payload.length, maxOutput);
    const p = header.model;
    const pkg = { config: p.config, meta: p.meta, tensors: p.tensors, fixes: [] };
    for (const [key, s] of Object.entries(p.blobs)) pkg[key] = base64(payload.subarray(s.offset, s.offset + s.length));
    return root.BookDecoder.buildModel(pkg, root.BookDecoder.decodeBlobs(pkg));
  }
  // Python hands JSON to these functions; the JavaScript engine receives no file access.
  const engine = {
    init(header, payloadB64) {
      const payload = root.BookDecoder.base64ToBytes(payloadB64);
      this.header = header; this.payload = payload; this.model = neuralModel(header, payload);
      return true;
    },
    decode(indices) {
      return indices.map((i) => {
        const s = this.header.model.segments[i], parts = [];
        root.BookDecoder.decodeSegment(this.model, s, this.payload.subarray(s.offset, s.offset + s.length),
          (c, b) => parts.push(b));
        const bytes = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
        let pos = 0; for (const b of parts) { bytes.set(b, pos); pos += b.length; }
        return { index: i, data: base64(bytes) };
      });
    },
    encode(pkg, textB64, plan) {
      const text = root.BookDecoder.base64ToBytes(textB64);
      const model = root.BookDecoder.buildModel(pkg, root.BookDecoder.decodeBlobs(pkg));
      return plan.map((s) => ({ ...s, data: base64(root.BookDecoder.encodeSegment(model, text, s.first, s.count)) }));
    },
    beginEncode(pkg, textB64) {
      this.text = root.BookDecoder.base64ToBytes(textB64);
      this.model = root.BookDecoder.buildModel(pkg, root.BookDecoder.decodeBlobs(pkg));
      return true;
    },
    encodeOne(s) {
      return { ...s, data: base64(root.BookDecoder.encodeSegment(this.model, this.text, s.first, s.count)) };
    },
  };
  root.LCPArchive = { MAGIC, MAX_HEADER, validate, parseRaw, raw, base64, neuralModel };
  root.LCPEngine = engine;
})(typeof globalThis !== "undefined" ? globalThis : this);
