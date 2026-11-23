'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asset } from '../lib/paths';
import { ENCODE_SAMPLES, DECODE_SAMPLES } from '../lib/samples';
import { clock, estimate, formatBytes as format } from '../lib/format';
import LiveReader from './LiveReader';
import Result from './Result';

const labels = { reading: 'Reading your file', preparing: 'Preparing the model engine', training: 'Learning your text', encoding: 'Writing the model archive', verifying: 'Verifying every byte', decoding: 'Restoring your text' };
const textExtensions = /\.(txt|md|mdx|csv|tsv|json|jsonl|log|xml|html|css|js|jsx|mjs|cjs|ts|tsx|py|yaml|yml|toml|ini|sql|sh|c|cpp|h|rs|go|rb|tex)$/i;
function DocumentIcon() {
  return <svg viewBox="0 0 32 38" aria-hidden="true"><path d="M6 2h13l7 7v27H6zM19 2v8h7M11 17h10M11 23h10M11 29h6"/></svg>;
}
function ProgressPanel({ event, started, watched, paused }) {
  const [now, setNow] = useState(() => performance.now());
  const phase = useRef({ stage: event.stage, at: performance.now() });
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 500); return () => clearInterval(timer); }, []);
  useEffect(() => { phase.current = { stage: event.stage, at: performance.now() }; }, [event.stage]);
  const determinate = ['training', 'encoding', 'verifying', 'decoding'].includes(event.stage) && event.progress >= 0;
  const details = [`Elapsed ${clock(Math.max(0, (now - started) / 1000))}`];
  if (event.totalChunks) details.push(`${event.completedChunks || 0}/${event.totalChunks} chunks`);
  if (event.totalBytes) details.push(`${format(event.completedBytes || 0)} of ${format(event.totalBytes)}`);
  if (event.steps) details.push(`${event.steps} training updates`);
  if (!watched && event.progress > 0.02 && event.progress < 1 && now - phase.current.at >= 1000) {
    details.push(`~${clock((now - phase.current.at) / 1000 * (1 - event.progress) / event.progress)} left in this stage`);
  }
  if (paused) details.push('Paused');
  return <div className={`output-progress${watched ? ' compact-progress' : ''}`} id="output-progress">
    <div className="progress-meta"><strong id="progress-title">{paused ? 'Reconstruction paused' : labels[event.stage] || 'Working on your file'}</strong><span>{determinate ? `${Math.round(event.progress * 100)}%` : ''}</span></div>
    <progress max="100" value={determinate ? event.progress * 100 : undefined} aria-label={`${event.stage === 'decoding' ? 'Decoding' : 'Encoding'} progress`}/>
    <p id="progress-detail">{details.join(' · ')}</p>
  </div>;
}

async function archiveMetadata(file) {
  const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (prefix.length !== 12 || new TextDecoder().decode(prefix.subarray(0, 8)) !== 'NEURZIP1') return null;
  const length = new DataView(prefix.buffer).getUint32(8, true);
  if (!length || length > (1 << 20) || length + 12 > file.size) return null;
  try {
    const header = JSON.parse(await file.slice(12, 12 + length).text());
    if (!Number.isSafeInteger(header.size) || header.size < 0 || header.size > 0xffffffff) return null;
    const count = header.model?.meta?.n_chunks;
    return { size: header.size, chunks: Number.isSafeInteger(count) && count >= 0 && count <= 16777216 ? count : 0, name: header.name };
  } catch { return null; }
}

export default function Workbench() {
  const [action, setAction] = useState('encode');
  const [source, setSource] = useState('file');
  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState('');
  const [sampleId, setSampleId] = useState('');
  const [metadata, setMetadata] = useState(null);
  const [seconds, setSeconds] = useState('15');
  const [watch, setWatch] = useState(true);
  const [watchSession, setWatchSession] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState(false);
  const worker = useRef(null), fetchController = useRef(null), generation = useRef(0), started = useRef(0), objectURL = useRef(null);
  const fileInput = useRef(null), download = useRef(null), encodeTab = useRef(null), decodeTab = useRef(null), reader = useRef(null);
  const lastStage = useRef(''), pendingChunk = useRef(null);
  const attachReader = useCallback(instance => {
    reader.current = instance;
    if (instance && pendingChunk.current) { instance.append(pendingChunk.current); pendingChunk.current = null; }
  }, []);
  const pastedBytes = useMemo(() => new TextEncoder().encode(draft).length, [draft]);
  const encode = action === 'encode', pasted = encode && source === 'paste';
  const ready = pasted ? draft.length > 0 : !!file;
  const inputBytes = pasted ? pastedBytes : file?.size || 0;
  const restoredBytes = !encode && metadata ? metadata.size : inputBytes;
  const predicted = estimate(encode ? inputBytes : restoredBytes, action, seconds, !encode && watch, metadata?.chunks || 0);
  const large = inputBytes > 1_000_000 || restoredBytes > 1_000_000;
  const lengthy = predicted.high > 120;

  useEffect(() => () => {
    generation.current++;
    worker.current?.terminate(); fetchController.current?.abort();
    if (objectURL.current) URL.revokeObjectURL(objectURL.current);
  }, []);
  useEffect(() => { if (result) download.current?.focus({ preventScroll: true }); }, [result]);
  const nextChunk = useCallback((session, chunk) => {
    if (session === generation.current) worker.current?.postMessage({ action: 'next', chunk });
  }, []);
  const pauseChanged = useCallback(value => setPaused(value), []);

  function clearResult() {
    if (objectURL.current) URL.revokeObjectURL(objectURL.current);
    objectURL.current = null; pendingChunk.current = null; setResult(null); setProgress(null); setError(''); setWatchSession(0); setPaused(false);
  }
  function cancel() {
    generation.current++;
    fetchController.current?.abort(); fetchController.current = null;
    worker.current?.terminate(); worker.current = null;
    setBusy(false); clearResult(); setAnnouncement('Cancelled. No file was saved.');
  }
  function changeAction(next, focus = false) {
    if (busy) cancel();
    generation.current++;
    setAction(next); setSource('file'); setFile(null); setMetadata(null); setSampleId(''); clearResult();
    if (fileInput.current) fileInput.current.value = '';
    if (focus) (next === 'encode' ? encodeTab : decodeTab).current?.focus();
  }
  function changeSource(next) {
    if (busy) return;
    setSource(next); clearResult();
  }
  async function chooseFile(next) {
    if (!next || busy) return;
    clearResult();
    const selectedAction = next.name.toLowerCase().endsWith('.nzip') ? 'decode' : action;
    if (selectedAction === 'encode' && /\.[^./]+$/.test(next.name) && !textExtensions.test(next.name) && !next.type.startsWith('text/')) {
      setError('Choose a UTF-8 text file, such as .txt, .md, .json or .csv. PDF and image files are not supported.'); return;
    }
    const id = ++generation.current;
    setSource('file'); setSampleId(''); setMetadata(null); setAction(selectedAction); setFile(next);
    setAnnouncement(`${next.name} selected. ${format(next.size)}.`);
    if (selectedAction === 'decode') {
      const info = await archiveMetadata(next);
      if (id === generation.current) setMetadata(info);
    }
  }
  async function loadSample(sample) {
    if (busy) return;
    clearResult(); setSource('samples'); setBusy(true); setProgress({ stage: 'reading', progress: 0 });
    started.current = performance.now();
    const id = ++generation.current, controller = new AbortController(); fetchController.current = controller;
    try {
      const response = await fetch(asset(sample.file), { signal: controller.signal });
      if (!response.ok) throw new Error('This sample could not be loaded. Try again or choose your own file.');
      const blob = await response.blob();
      if (id !== generation.current) return;
      const selected = new File([blob], sample.name, { type: action === 'encode' ? 'text/plain' : 'application/octet-stream' });
      const info = action === 'decode' ? await archiveMetadata(selected) : null;
      if (id !== generation.current) return;
      setFile(selected); setMetadata(info); setSampleId(sample.id); setBusy(false); setProgress(null); fetchController.current = null;
      setAnnouncement(`${sample.title} is ready. ${action === 'encode' ? 'Choose Encode file to train a model.' : 'Choose Decode archive to restore it.'}`);
    } catch (e) {
      if (id === generation.current && e.name !== 'AbortError') { setBusy(false); setProgress(null); setError(e.message); }
    }
  }
  async function runJob() {
    if (!ready || busy) return;
    clearResult();
    const selected = pasted ? new File([new TextEncoder().encode(draft)], 'pasted-text.txt', { type: 'text/plain' }) : file;
    const id = ++generation.current;
    started.current = performance.now(); lastStage.current = '';
    setBusy(true); setProgress({ stage: 'reading', progress: 0 });
    if (!encode && watch) setWatchSession(id);
    setAnnouncement(encode ? 'Model training started on your device.' : 'Restoring your text with the saved model.');
    try {
      const instance = new Worker(asset('runtime/codec-worker.js'), { type: 'module' });
      worker.current = instance;
      const fail = message => {
        if (id !== generation.current) return;
        instance.terminate(); worker.current = null; setBusy(false); setProgress(null); setWatchSession(0);
        setError(message); setAnnouncement(message);
      };
      instance.onerror = () => fail('The browser could not finish this job. Try a smaller excerpt or close other busy tabs.');
      instance.onmessage = ({ data }) => {
        if (id !== generation.current) return;
        if (data.type === 'metadata') setMetadata({ size: data.header.size, chunks: data.header.totalChunks, name: data.header.name });
        if (data.type === 'chunk') { if (reader.current) reader.current.append(data); else pendingChunk.current = data; }
        if (data.type === 'progress') {
          setProgress(data);
          if (data.stage !== lastStage.current) { lastStage.current = data.stage; setAnnouncement(labels[data.stage] || 'Working'); }
        }
        if (data.type === 'error') fail(data.message);
        if (data.type === 'result') {
          instance.terminate(); worker.current = null;
          objectURL.current = URL.createObjectURL(new Blob([data.buffer], { type: 'application/octet-stream' }));
          const preview = data.action === 'decode' ? new TextDecoder().decode(new Uint8Array(data.buffer).subarray(0, 20000)) : '';
          setResult({ ...data, buffer: undefined, url: objectURL.current, preview });
          setBusy(false); setProgress(null); setAnnouncement(`${data.name} is ready. Every original byte verified.`);
        }
      };
      // Structured-clone the File handle. Its contents are read in the worker,
      // rather than allocating a second complete input buffer on the UI thread.
      instance.postMessage({ action, name: selected.name, file: selected, seconds: Number(seconds), watch: !encode && watch });
    } catch (e) { setBusy(false); setProgress(null); setWatchSession(0); setError(e.message); }
  }

  const samples = encode ? ENCODE_SAMPLES : DECODE_SAMPLES;
  const sources = encode ? [['file', 'Upload file'], ['paste', 'Paste text'], ['samples', 'Samples']] : [['file', 'Upload archive'], ['samples', 'Book library']];
  return <section className="workspace page-width" id="workspace" aria-label="Model compression tool">
    <div className="workbench-top">
      <div className="tabs" role="tablist" aria-label="Choose an action">{['encode', 'decode'].map(name => <button key={name} id={`tab-${name}`} role="tab" aria-selected={name === action} aria-controls="tool-panel" tabIndex={name === action ? 0 : -1} disabled={busy} ref={name === 'encode' ? encodeTab : decodeTab} onClick={() => changeAction(name)} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); changeAction(event.key === 'Home' ? 'encode' : event.key === 'End' ? 'decode' : encode ? 'decode' : 'encode', true);
        }
      }}>{name === 'encode' ? 'Encode' : 'Decode'}<span>{name === 'encode' ? 'Train & pack' : 'Restore exactly'}</span></button>)}</div>
      <span className="privacy-note"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8V6a5 5 0 0 1 10 0v2M4 8h12v10H4z"/></svg>On your device</span>
    </div>
    <div className="tool-panel" id="tool-panel" role="tabpanel" aria-labelledby={`tab-${action}`}>
      <div className="input-side">
        <div className="panel-label"><h2>{encode ? 'Your text' : 'Your archive'}</h2><span>{encode ? 'UTF-8 text' : '.nzip format'}</span></div>
        <div className="source-switch" role="group" aria-label="Input source">{sources.map(([value, label]) => <button key={value} aria-pressed={source === value} disabled={busy} onClick={() => changeSource(value)}>{label}</button>)}</div>
        {source === 'file' && <div className={`dropzone${dragging ? ' dragover' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
          <div className="file-icon"><DocumentIcon/></div><h3>{encode ? 'Drop a text file here' : 'Drop a model archive here'}</h3><p>{encode ? 'Books, notes, code, logs. Every byte stays yours.' : 'Use its saved model to bring the original back.'}</p>
          <label className="button secondary file-picker" htmlFor="file-input">{file ? 'Choose another file' : encode ? 'Choose a text file' : 'Choose an archive'}<input ref={fileInput} id="file-input" type="file" disabled={busy} accept={encode ? '.txt,.md,.csv,.json,.jsonl,.log,.xml,.html,.css,.js,.py,text/*,.nzip' : '.nzip'} onChange={event => chooseFile(event.target.files[0])}/></label>
          <p className="drop-alternative">Or <button className="text-button" disabled={busy} onClick={() => changeSource('samples')}>{encode ? 'try a sample' : 'choose a book'}</button></p>
        </div>}
        {pasted && <div className="paste-panel"><label className="sr-only" htmlFor="paste-text">Text to encode</label><textarea id="paste-text" placeholder="Paste or type your text here…" value={draft} disabled={busy} spellCheck={false} aria-describedby="paste-note paste-size" onChange={event => { setDraft(event.target.value); if (result || error) clearResult(); }}/><div className="paste-meta"><span>pasted-text.txt</span><span id="paste-size">{format(pastedBytes)} · UTF-8</span></div><p id="paste-note">Encoded as UTF-8. Upload an existing file to preserve its original bytes and line endings.</p></div>}
        {source === 'samples' && <div className="sample-library"><p className="sample-intro">{encode ? 'Choose text to train a new model on your device.' : 'Finished models, ready to reconstruct. No training needed.'}</p><div className="sample-list" role="group" aria-label={encode ? 'Encoding samples' : 'Book samples'}>{samples.map(sample => <button key={sample.id} className="sample-row" disabled={busy} aria-pressed={sampleId === sample.id} onClick={() => loadSample(sample)}><span className="sample-book-icon"><DocumentIcon/></span><span className="sample-copy"><strong>{sample.title}</strong><span>{sample.author}{sample.detail ? ` · ${sample.detail}` : ''}</span></span><span className="sample-size">{sample.bytes ? format(sample.bytes) : 'Small text'}{sample.restoredBytes ? <small>{format(sample.restoredBytes)} restored</small> : null}</span></button>)}</div></div>}
        {!pasted && file && <div className="selected-file"><div><span className="selected-check" aria-hidden="true">✓</span><div><strong id="file-name">{file.name}</strong><span>{format(file.size)}{metadata ? ` · ${format(metadata.size)} restored` : ''}</span></div></div><button className="icon-button" disabled={busy} aria-label="Remove selected file" onClick={() => { setFile(null); setMetadata(null); setSampleId(''); clearResult(); if (fileInput.current) fileInput.current.value = ''; }}>×</button></div>}
        {encode ? <div className="encode-options"><label htmlFor="training-budget">Training budget</label><select id="training-budget" disabled={busy} value={seconds} onChange={event => setSeconds(event.target.value)}><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option></select><p>Longer learning can help compression. Coding and verification take additional time.</p></div> : <div className="watch-option"><label><input type="checkbox" checked={watch} disabled={busy} onChange={event => setWatch(event.target.checked)}/><span><strong>Watch reconstruction</strong><small>See actual decoded chunks appear one at a time.</small></span></label></div>}
        {ready && !busy && <div className={`job-estimate${large || lengthy ? ' estimate-warning' : ''}`} id="job-estimate"><strong>{large ? 'A larger experiment' : lengthy ? 'This may take a while' : 'Estimated time'}<span>{predicted.label}</span></strong><p>{large || lengthy ? 'Large jobs can take many minutes and use more browser memory. Keep this tab open; cancel whenever you need to.' : 'A rough, device-dependent estimate. Progress will refine it as work completes.'}</p>{encode && inputBytes > (16 << 20) && <p>Archives restoring more than 16 MiB currently need this browser decoder; Python 0.3.1 supports up to 16 MiB.</p>}</div>}
        <div className="action-row"><button className="button primary run-button" disabled={busy || !ready} onClick={runJob}>{busy ? encode ? 'Encoding…' : 'Decoding…' : encode ? 'Encode file' : 'Decode archive'}</button>{busy && <button className="button secondary" onClick={cancel}>Cancel</button>}<span>{busy ? 'You can cancel at any time.' : 'Files stay on your device.'}</span></div>
        {error && <div className="error-message" id="error-message" role="alert">{error}</div>}
      </div>
      <div className="output-side"><div className="output-heading"><h2>{encode ? 'Your model archive' : 'Your restored text'}</h2><span className="output-method">{watchSession ? 'WATCH MODE' : 'MODEL + STREAM'}</span></div>
        {busy && progress && <ProgressPanel event={progress} started={started.current} watched={!!watchSession} paused={paused}/>}
        {!!watchSession && <LiveReader ref={attachReader} key={watchSession} session={watchSession} onNext={nextChunk} onPauseChange={pauseChanged} done={!!result}/>}
        {result && <Result result={result} downloadRef={download} watched={!!watchSession}/>}
        {!busy && !result && !watchSession && <div className="output-empty" id="output-empty"><DocumentIcon/><h3>{encode ? 'A model of your words.' : 'Watch a book come back.'}</h3><p>{encode ? 'Add text on the left. Your download will include the learned weights and lossless stream.' : 'Choose an archive or a book sample. Follow each chunk as the saved model reconstructs the text.'}</p><span className="empty-proof">Exact bytes. Verified before download.</span></div>}
      </div>
    </div>
    <div className="workbench-bottom"><span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9"/></svg>Lossless, with SHA-256 verification</span><span>Client-side processing · No file uploads</span></div>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
  </section>;
}
