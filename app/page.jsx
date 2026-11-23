import { Header, Footer } from '../components/Chrome';
import Workbench from '../components/Workbench';
import Install from '../components/Install';
import { asset } from '../lib/paths';

export default function Page() {
  return <><Header/><main>
    <section className="intro page-width" aria-labelledby="page-title">
      <div className="intro-copy"><p className="eyebrow">THE NEURAL COMPRESSION PLAYGROUND</p><h1 id="page-title">Your text. A tiny model.<br/><span>Every byte, back.</span></h1><p className="intro-description">Train on your own text, or watch a saved model reconstruct a book. Everything runs on your device.</p></div>
      <div className="process-note" aria-label="Text is encoded as model weights and a lossless stream, then restored exactly"><div className="process-line"><span className="process-file">.txt</span><span className="process-connector" aria-hidden="true"/><span className="process-file archive-file">.nzip</span><span className="process-connector" aria-hidden="true"/><span className="process-file">.txt</span></div><p>Text <span>Model + stream</span> Original bytes</p><small>Learn it. Pack it. Bring it back.</small></div>
    </section>
    <Workbench/>
    <Install/>
    <section className="explanation page-width" id="how-it-works" aria-labelledby="how-title"><div className="explanation-heading"><p className="eyebrow">WHAT HAPPENS TO YOUR TEXT</p><h2 id="how-title">A model learns.<br/>A stream keeps it exact.</h2><p>The model predicts each byte. Arithmetic coding stores the information needed to recover the exact original.</p></div><div className="explanation-body"><article><h3>Encoding teaches a model.</h3><p>A small transformer trains on your text. Its weights and lossless stream travel together in a .nzip archive. Short files can grow because the model has a storage cost.</p></article><article><h3>Decoding reveals the original.</h3><p>The saved model reconstructs your text without retraining. Watch each real chunk appear, then download the complete file after its SHA-256 is verified.</p></article><article><h3>Processing stays in your browser.</h3><p>Uploads and pasted text stay on your device. Larger files get time and memory guidance, with progress and cancellation throughout.</p><a className="text-button" href={asset('docs/')}>Read the quick start</a></article></div></section>
  </main><Footer/></>;
}
