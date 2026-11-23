import CopyButton from './CopyButton';
import { asset, WHEEL } from '../lib/paths';

export default function Install() {
  const commands = 'python -m pip install neuralzip\nneuralzip encode notes.txt\nneuralzip decode notes.txt.nzip';
  return <section className="python-section page-width" id="python" aria-labelledby="python-title">
    <div><p className="eyebrow">THE SAME MODEL, IN YOUR TERMINAL</p><h2 id="python-title">Encode. Decode.<br/>Every byte, back.</h2><p>One Python package. Every original byte verified.<br/>Decode uses the model saved in your archive.</p><a className="text-button download-link" href={asset('downloads/' + WHEEL)} download>Download wheel <span>v0.3.1</span></a></div>
    <div className="terminal"><div className="terminal-header"><span>Python 3.10+</span><CopyButton text={commands}/></div>
      <div className="terminal-code"><p className="terminal-comment"># Install Neuralzip</p><code>python -m pip install neuralzip</code><p className="terminal-comment"># Make a lossless model archive</p><code>neuralzip encode notes.txt</code><p className="terminal-comment"># Restore the exact original file</p><code>neuralzip decode notes.txt.nzip</code></div>
      <details className="terminal-more"><summary>Use the Python API</summary><pre><code>{'from neuralzip import encode, decode\n\noriginal = b"Keep every byte."\narchive = encode(original)\nassert decode(archive) == original'}</code></pre></details>
      <details className="terminal-more"><summary>First-time setup: a virtual environment</summary><p>macOS or Linux:</p><code>python3 -m venv .venv<br/>source .venv/bin/activate</code><p>Windows PowerShell:</p><code>{'py -m venv .venv'}<br/>{'.\\.venv\\Scripts\\Activate.ps1'}</code><p>Then run the install command above. The package installs the training dependencies for you.</p></details>
    </div>
  </section>;
}
