import { formatBytes as format } from '../lib/format';

export default function Result({ result, downloadRef, watched }) {
  const encoding = result.action === 'encode', saved = result.originalBytes - result.archiveBytes;
  const caption = encoding ? saved > 0 ? `${(100 * saved / result.originalBytes).toFixed(1)}% less space · ${(result.originalBytes / result.archiveBytes).toFixed(2)}× smaller` : `This model archive is ${format(-saved)} larger than the input.` : 'Every original byte restored. Checksum matches.';
  return <div className={`output-result${watched ? ' watched-result' : ''}`} id="output-result">
    <div className="verified"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="m6 10 3 3 5-6"/></svg><span>Every byte verified</span></div>
    <h3 id="result-title">{result.name}</h3>
    <div className="size-comparison"><div><span>{encoding ? 'Original' : 'Archive'}</span><strong id="original-size">{format(encoding ? result.originalBytes : result.archiveBytes)}</strong></div><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg><div><span>{encoding ? 'Model archive' : 'Restored'}</span><strong id="archive-size">{format(encoding ? result.archiveBytes : result.originalBytes)}</strong></div></div>
    <p className="savings-caption" id="savings-caption">{caption}</p>
    <a className="button primary download-button" id="download-button" ref={downloadRef} href={result.url} download={result.name}>{encoding ? 'Download model archive' : 'Download restored file'}</a>
    <p className="result-note" id="result-note">{encoding ? saved > 0 ? 'Learned weights and the lossless stream, together in one file.' : 'Model overhead can outweigh savings on short text. This is the actual model archive.' : 'Original bytes, including spaces and line endings. No retraining.'}</p>
    {encoding && result.weightsBytes !== undefined && <details className="verification-details"><summary>Inside your model archive</summary><dl><dt>Model weights</dt><dd>{format(result.weightsBytes)}</dd><dt>Arithmetic-coded stream</dt><dd>{format(result.streamBytes)}</dd><dt>Settings and checksum</dt><dd>{format(result.settingsBytes)}</dd></dl></details>}
    <details className="verification-details"><summary>Verification details</summary><dl><dt>SHA-256 of original</dt><dd id="result-hash">{result.sha256}</dd><dt>Time on this device</dt><dd>{result.seconds.toFixed(2)} seconds</dd><dt>Compression method</dt><dd>Neural model + arithmetic-coded stream</dd></dl></details>
    {!encoding && !watched && <details className="preview-details"><summary>Preview restored text</summary><pre id="result-preview" className="text-preview" tabIndex="0">{result.preview}</pre></details>}
  </div>;
}
