import browser from '../public/browser-acceptance.json';
import { asset } from '../lib/paths';

const size = bytes => `${(bytes / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`;

export default function BrowserBenchmarks() {
  return <section aria-labelledby="browser-results-title">
    <h2 id="browser-results-title">Fresh browser encoding</h2>
    <p>The same source files were encoded with the released and updated browser trainers. Sizes include the entire model archive. Every result was independently decoded and compared byte for byte.</p>
    <div className="table-scroll" tabIndex="0" aria-label="Fresh browser compression results">
      <table aria-labelledby="browser-results-title">
        <thead><tr><th scope="col">Text</th><th scope="col">Original</th><th scope="col">Before fix</th><th scope="col">After fix</th></tr></thead>
        <tbody>{browser.results.map(row => <tr key={row.title}><th scope="row">{row.title}</th><td>{size(row.source_bytes)}</td><td>{size(row.previous_archive_bytes)}</td><td>{size(row.archive_bytes)}</td></tr>)}</tbody>
      </table>
    </div>
    <p>Measured on GitHub&apos;s software WebGL runner. Learning runs and devices can produce different archive sizes and timings. Short or difficult text can still grow.</p>
    <a className="text-button" href={asset('browser-acceptance.json')}>Download browser measurements</a>
  </section>;
}
