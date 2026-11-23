'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { clock, formatBytes } from '../lib/format';

const WINDOW = 48000;
const LiveReader = forwardRef(function LiveReader({ session, onNext, onPauseChange, done }, ref) {
  const [view, setView] = useState({ text: '', latest: '', chunk: 0, total: 0, bytes: 0, decodeMs: 0, clipped: false });
  const [paused, setPaused] = useState(false);
  const [pace, setPace] = useState('40');
  const [follow, setFollow] = useState(true);
  const decoder = useRef(null), viewport = useRef(null), pausedRef = useRef(false), pending = useRef(null);

  function append(event) {
      if (pausedRef.current) { pending.current = event; return; }
      if (!decoder.current) decoder.current = new TextDecoder();
      const text = decoder.current.decode(new Uint8Array(event.buffer), { stream: true });
      setView(previous => {
        const all = previous.text + previous.latest;
        const clipped = previous.clipped || all.length + text.length > WINDOW;
        let retained = all.slice(-WINDOW);
        if (/^[\uDC00-\uDFFF]/.test(retained)) retained = retained.slice(1);
        return { text: retained, latest: text, chunk: event.chunk + 1,
          total: event.totalChunks, bytes: event.completedBytes, decodeMs: event.decodeMs || 0, clipped };
      });
  }
  useImperativeHandle(ref, () => ({ append }), []);

  useEffect(() => {
    if (!view.chunk || paused || done) return;
    let frame;
    const timer = setTimeout(() => { frame = requestAnimationFrame(() => { if (!pausedRef.current) onNext(session, view.chunk - 1); }); }, Number(pace));
    return () => { clearTimeout(timer); if (frame) cancelAnimationFrame(frame); };
  }, [view.chunk, paused, pace, done, onNext, session]);
  useEffect(() => {
    if (follow && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [view.chunk, follow]);
  function togglePause() {
    const next = !paused; pausedRef.current = next; setPaused(next); onPauseChange(next);
    if (!next && pending.current) { const event = pending.current; pending.current = null; append(event); }
  }

  return <section className="live-reader" aria-label="Live reconstruction">
    <div className="reader-title"><div><span className="reader-label">LIVE RECONSTRUCTION</span><h3>{done ? 'Your text, restored.' : paused ? 'Reconstruction paused' : view.chunk ? 'The model is writing.' : 'Waiting for the first chunk'}</h3></div>
      {!done && <button className="button secondary reader-pause" onClick={togglePause} aria-label={paused ? 'Resume reconstruction' : 'Pause reconstruction'}>{paused ? 'Resume' : 'Pause'}</button>}
    </div>
    <div className="reader-toolbar"><span id="watch-chunk-count" data-chunk={view.chunk}>Chunk {view.chunk.toLocaleString()} of {view.total ? view.total.toLocaleString() : done ? '0' : '…'}</span>
      {!done && <label className="reader-speed">Reveal speed<select aria-label="Reveal speed" value={pace} onChange={event => setPace(event.target.value)}><option value="0">Live</option><option value="40">Natural</option><option value="150">Slow</option></select></label>}
    </div>
    <pre id="live-preview" ref={viewport} className="reader-page" tabIndex="0" aria-label="Text being restored" onScroll={event => {
      const el = event.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 50) setFollow(false);
    }}>{view.text}<span className="latest-chunk" key={view.chunk}>{view.latest}</span>{!done && <span className="reader-caret" aria-hidden="true"/>}{!view.chunk && <span className="reader-placeholder">{done ? 'The original file is empty.' : 'Actual decoded text will appear here, one chunk at a time.'}</span>}</pre>
    <div className="reader-footer"><span>{formatBytes(view.bytes)} restored{!done && !paused && view.chunk >= 3 && view.chunk < view.total ? ` · ~${clock((view.total - view.chunk) * (view.decodeMs / view.chunk + Number(pace) + 16) / 1000)} left` : ''}{view.clipped ? ' · Recent text shown' : ''}</span><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)}/>Follow latest</label></div>
    <p className="reader-integrity">{done ? 'Complete file verified with SHA-256. The download includes every byte.' : 'Live preview. The complete file is verified before a download is offered.'}</p>
  </section>;
});
export default LiveReader;
