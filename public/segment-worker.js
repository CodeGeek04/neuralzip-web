/* Loaded only for neural decoding. Same codec as the Python package. */
importScripts('./codec/decoder.js', './codec/archive.js');
self.onmessage = ({ data: { header, payload, indices } }) => {
  try {
    const model = LCPArchive.neuralModel(header, payload);
    for (const index of indices) {
      const s = header.model.segments[index];
      BookDecoder.decodeSegment(model, s, payload.subarray(s.offset, s.offset + s.length), (chunk, bytes) => {
        self.postMessage({ chunk, bytes: bytes.buffer }, [bytes.buffer]);
      });
    }
    self.postMessage({ done: true });
  } catch (error) { self.postMessage({ error: error.message }); }
};
