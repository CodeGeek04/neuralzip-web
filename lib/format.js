export function formatBytes(n) {
  return n < 1000 ? `${n.toLocaleString()} B` : n < 1e6 ? `${(n / 1000).toFixed(1)} KB` : `${(n / 1e6).toFixed(2)} MB`;
}
export function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function duration(seconds) {
  if (seconds < 60) return `${Math.max(5, Math.ceil(seconds / 5) * 5)} sec`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}
export function estimate(bytes, action, seconds, watch = false, chunks = 0, pace = 40) {
  const training = action === 'encode' ? Number(seconds) : 0;
  const pacing = watch && chunks ? chunks * pace / 1000 : 0;
  const low = training + bytes / (action === 'encode' ? 12000 : 20000) + pacing;
  const high = training + bytes / (action === 'encode' ? 2000 : 5000) + pacing + 10;
  return { low, high, label: duration(low) === duration(high) ? `About ${duration(high)}` : `${duration(low)} to ${duration(high)}` };
}
