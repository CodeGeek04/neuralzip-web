import * as tf from '@tensorflow/tfjs';

const bits = new DataView(new ArrayBuffer(4));
export function bf16(x) {
  bits.setFloat32(0, x, true);
  const n = bits.getUint32(0, true);
  return ((n + 0x7fff + ((n >>> 16) & 1)) >>> 16) & 65535;
}
export function bfValue(x) { bits.setUint32(0, x << 16, true); return bits.getFloat32(0, true); }
export function roundEven(x) {
  const floor = Math.floor(x), fraction = x - floor;
  return fraction === 0.5 ? floor + (floor % 2 !== 0 ? 1 : 0) : Math.round(x);
}

function roundedBfloat(x) {
  const quantum = tf.pow(2, x.abs().maximum(2 ** -126).log().div(Math.LN2).floor().sub(7));
  return x.div(quantum).round().mul(quantum);
}

// Straight-through gradients let master weights learn with the q8 matrices and
// bf16 vectors that the archive's decoder will actually receive.
export const archiveWeights = tf.customGrad(x => ({
  value: tf.tidy(() => {
    if (x.rank === 1) return roundedBfloat(x);
    const scale = roundedBfloat(x.abs().max(1, true).maximum(1e-8).div(127));
    return x.div(scale).round().clipByValue(-127, 127).mul(scale);
  }),
  gradFunc: gradient => gradient,
}));
