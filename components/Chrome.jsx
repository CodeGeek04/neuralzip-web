import { asset, LIBRARY_REPO, WEBSITE_REPO } from '../lib/paths';

export function Header() {
  return <header className="masthead page-width">
    <a className="wordmark" href={asset('')} aria-label="Neuralzip home"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 3h13l5 5v17H5z"/><path d="M18 3v6h5M10 12h8M10 16h8M10 20h5"/></svg><span>Neuralzip</span></a>
    <nav aria-label="Main navigation"><a href={asset('docs/')}>Quick start</a><a href={asset('benchmarks/')}>Benchmarks</a><a className="source-link" href={LIBRARY_REPO}>Source <span className="version">v0.3.1</span></a></nav>
  </header>;
}

export function Footer() {
  return <footer className="footer page-width"><span className="footer-brand">Neuralzip <span>Fold your text. Keep every byte.</span></span><div><a href={LIBRARY_REPO}>Library source</a><a href={WEBSITE_REPO}>Website source</a><a href={asset('FORMAT.txt')}>Archive format</a><a href={asset('LICENSE.txt')}>MIT license</a></div></footer>;
}
