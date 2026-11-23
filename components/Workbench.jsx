'use client';

import { useEffect, useRef, useState } from 'react';
import { asset } from '../lib/paths';

const format = n => n < 1000 ? `${n.toLocaleString()} B` : n < 1e6 ? `${(n / 1000).toFixed(1)} KB` : `${(n / 1e6).toFixed(2)} MB`;
const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const labels = { reading: 'Reading the model archive', preparing: 'Preparing the training engine', training: 'Learning your text', encoding: 'Writing the model archive', verifying: 'Verifying every byte', decoding: 'Restoring your text' };

function ProgressPanel({ event, started }) {
  const [now, setNow] = useState(() => performance.now());
  const phase = useRef({ stage: event.stage, at: performance.now() });
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { phase.current = { stage: event.stage, at: performance.now() }; }, [event.stage]);
  const determinate = ['training', 'encoding', 'verifying', 'decoding'].includes(event.stage) && event.progress >= 0;
  const details = [`Elapsed ${clock(Math.max(0, (now - started) / 1000))}`];
  if (event.totalChunks) details.push(`${event.completedChunks || 0}/${event.totalChunks} chunks`);
  if (event.totalBytes) details.push(`${format(event.completedBytes || 0)} of ${format(event.totalBytes)}`);
  if (event.steps) details.push(`${event.steps} training updates`);
  if (event.progress > 0.02 && event.progress < 1 && now - phase.current.at >= 1000) {
    details.push(`~${clock((now - phase.current.at) / 1000 * (1 - event.progress) / event.progress)} left in this stage`);
  }
  if (event.stage === 'preparing') details.push('Loading the training engine once');
  if (event.stage === 'verifying') details.push('Checking the original checksum');
  return <div className="output-progress" id="output-progress"><div className="progress-meta"><strong id="progress-title">{labels[event.stage] || 'Working on your file'}</strong><span id="progress-percent">{determinate ? `${Math.round(event.progress * 100)}%` : ''}</span></div><progress id="progress-bar" max="100" value={determinate ? event.progress * 100 : undefined} aria-label={`${event.stage === 'decoding' ? 'Decoding' : 'Encoding'} progress`}/><p id="progress-detail">{details.join(' · ')}</p>{event.preview ? <pre id="live-preview" className="text-preview live-preview" tabIndex="0" aria-label="Text being restored">{event.preview}</pre> : null}</div>;
}

function Result({ result, downloadRef }) {
  const encoding = result.action === 'encode', saved = result.originalBytes - result.archiveBytes;
  const caption = encoding ? saved > 0 ? `${(100 * saved / result.originalBytes).toFixed(1)}% less space · ${(result.originalBytes / result.archiveBytes).toFixed(2)}× smaller` : `This model archive is ${format(-saved)} larger than the input.` : 'Every original byte restored. Checksum matches.';
  return <div className="output-result" id="output-result"><div className="verified"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="m6 10 3 3 5-6"/></svg><span>Every byte verified</span></div><h3 id="result-title">{result.name}</h3><div className="size-comparison"><div><span>{encoding ? 'Original' : 'Archive'}</span><strong id="original-size">{format(encoding ? result.originalBytes : result.archiveBytes)}</strong></div><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg><div><span>{encoding ? 'Model archive' : 'Restored'}</span><strong id="archive-size">{format(encoding ? result.archiveBytes : result.originalBytes)}</strong></div></div><div className="savings-track" aria-hidden="true"><span style={{ width: `${result.originalBytes ? Math.min(100, Math.max(1, result.archiveBytes / result.originalBytes * 100)) : 100}%` }}/></div><p className="savings-caption" id="savings-caption">{caption}</p><a className="button primary download-button" id="download-button" ref={downloadRef} href={result.url} download={result.name}>{encoding ? 'Download model archive' : 'Download restored file'}</a><p className="result-note" id="result-note">{encoding ? saved > 0 ? 'The archive contains the learned model and encoded stream. Your original stays untouched.' : 'Model overhead can outweigh savings on short text. The model archive is kept exactly as trained.' : 'Original bytes, including spaces and line endings. No retraining was needed.'}</p>{encoding && result.weightsBytes !== undefined ? <details className="verification-details"><summary>Inside your model archive</summary><dl><dt>Model weights</dt><dd>{format(result.weightsBytes)}</dd><dt>Arithmetic-coded stream</dt><dd>{format(result.streamBytes)}</dd><dt>Settings and checksum</dt><dd>{format(result.settingsBytes)}</dd></dl></details> : null}<details className="verification-details"><summary>Verification details</summary><dl><dt>SHA-256 of original</dt><dd id="result-hash">{result.sha256}</dd><dt>Time on this device</dt><dd id="result-time">{result.seconds.toFixed(2)} seconds</dd><dt>Compression method</dt><dd id="result-codec">Neural model + arithmetic-coded stream</dd></dl></details>{!encoding ? <details className="preview-details" id="preview-details"><summary>Preview restored text</summary><pre id="result-preview" className="text-preview" tabIndex="0">{result.preview}</pre></details> : null}</div>;
}

export default function Workbench() {
  const [action, setAction] = useState('encode');
  const [file, setFile] = useState(null);
  const [seconds, setSeconds] = useState('30');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState(false);
  const worker = useRef(null), fetchController = useRef(null), generation = useRef(0), started = useRef(0), objectURL = useRef(null);
  const fileInput = useRef(null), download = useRef(null), encodeTab = useRef(null), decodeTab = useRef(null);

  useEffect(() => () => {
    generation.current++;
    worker.current?.postMessage({ action: 'cancel' }); worker.current?.terminate();
    fetchController.current?.abort();
    if (objectURL.current) URL.revokeObjectURL(objectURL.current);
  }, []);
  useEffect(() => { if (result) download.current?.focus({ preventScroll: true }); }, [result]);

  function clearResult() {
    if (objectURL.current) URL.revokeObjectURL(objectURL.current);
    objectURL.current = null; setResult(null); setProgress(null); setError('');
  }
  function cancel() {
    generation.current++;
    fetchController.current?.abort(); fetchController.current = null;
    worker.current?.postMessage({ action: 'cancel' }); worker.current?.terminate(); worker.current = null;
    setBusy(false); clearResult(); setAnnouncement('Cancelled. No file was saved.');
  }
  function changeAction(next, focus = false) {
    if (busy) cancel();
    setAction(next); setFile(null); clearResult();
    if (fileInput.current) fileInput.current.value = '';
    if (focus) (next === 'encode' ? encodeTab : decodeTab).current?.focus();
  }
  function chooseFile(next) {
    if (!next || busy) return;
    clearResult();
    const nextAction = next.name.toLowerCase().endsWith('.nzip') ? 'decode' : action;
    const limit = nextAction === 'encode' ? 500000 : 160 << 20;
    if (next.size > limit) { setError(nextAction === 'encode' ? 'Browser encoding supports up to 500 KB. Use the Python package for larger model jobs.' : 'This archive exceeds the browser size limit.'); return; }
    setAction(nextAction); setFile(next); setAnnouncement(`${next.name} selected. ${format(next.size)}.`);
  }
  async function runJob(selected = file, selectedAction = action) {
    if (!selected || busy) return;
    clearResult();
    const id = ++generation.current;
    started.current = performance.now(); setBusy(true);
    setProgress({ stage: selectedAction === 'encode' ? 'preparing' : 'reading', progress: 0 });
    setAnnouncement(selectedAction === 'encode' ? 'Model training started. Your file stays on this device.' : 'Restoring your text using the saved model.');
    try {
      const buffer = await selected.arrayBuffer();
      if (id !== generation.current) return;
      const instance = new Worker(asset('runtime/codec-worker.js'), { type: 'module' });
      worker.current = instance;
      instance.onerror = () => {
        if (id !== generation.current) return;
        instance.terminate(); worker.current = null; setBusy(false); setProgress(null);
        setError('The model job could not finish. Try again, or use the Python package.');
      };
      instance.onmessage = ({ data }) => {
        if (id !== generation.current) return;
        if (data.type === 'progress') setProgress(data);
        if (data.type === 'error') {
          instance.terminate(); worker.current = null; setBusy(false); setProgress(null); setError(data.message); setAnnouncement(data.message);
        }
        if (data.type === 'result') {
          instance.terminate(); worker.current = null;
          objectURL.current = URL.createObjectURL(new Blob([data.buffer], { type: 'application/octet-stream' }));
          const preview = data.action === 'decode' ? new TextDecoder().decode(new Uint8Array(data.buffer).subarray(0, 20000)) : '';
          setResult({ ...data, buffer: undefined, url: objectURL.current, preview });
          setBusy(false); setProgress(null); setAnnouncement(`${data.name} is ready. Every original byte verified.`);
        }
      };
      instance.postMessage({ action: selectedAction, name: selected.name, buffer, seconds: Number(seconds),
        segmentWorkerURL: new URL(asset('segment-worker.js'), location.href).href }, [buffer]);
    } catch (e) { if (id === generation.current) { setBusy(false); setProgress(null); setError(e.message); } }
  }
  async function sample(restore) {
    if (busy) return;
    clearResult();
    const selectedAction = restore ? 'decode' : 'encode';
    setAction(selectedAction); setBusy(true); started.current = performance.now();
    setProgress({ stage: 'reading', progress: 0 });
    const id = ++generation.current, controller = new AbortController(); fetchController.current = controller;
    try {
      const name = restore ? 'alice-neural.nzip' : 'alice.txt';
      const response = await fetch(asset('samples/' + name), { signal: controller.signal });
      if (!response.ok) throw new Error('The sample could not be loaded. Please choose a file instead.');
      const blob = await response.blob();
      if (id !== generation.current) return;
      const selected = new File([blob], name);
      setFile(selected); setBusy(false); setProgress(null); fetchController.current = null;
      if (restore) await runJob(selected, selectedAction);
      else setAnnouncement('Alice text is ready. Choose a training budget, then Encode file.');
    } catch (e) { if (id === generation.current && e.name !== 'AbortError') { setBusy(false); setProgress(null); setError(e.message); } }
  }

  const encode = action === 'encode';
  return <section className="workspace page-width" id="workspace" aria-label="Model compression tool"><div className="workbench-top"><div className="tabs" role="tablist" aria-label="Choose an action">{['encode', 'decode'].map(name => <button key={name} id={`tab-${name}`} role="tab" aria-selected={name === action} aria-controls="tool-panel" tabIndex={name === action ? 0 : -1} disabled={busy} ref={name === 'encode' ? encodeTab : decodeTab} onClick={() => changeAction(name)} onKeyDown={event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); changeAction(event.key === 'Home' ? 'encode' : event.key === 'End' ? 'decode' : action === 'encode' ? 'decode' : 'encode', true); }
  }}>{name === 'encode' ? 'Encode' : 'Decode'} <span>{name === 'encode' ? 'Train & pack' : 'Restore exactly'}</span></button>)}</div><span className="privacy-note"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8V6a5 5 0 0 1 10 0v2M4 8h12v10H4z"/></svg>On your device</span></div><div className="tool-panel" id="tool-panel" role="tabpanel" aria-labelledby={`tab-${action}`} aria-busy={busy}><div className="input-side"><div className={`dropzone${dragging ? ' dragover' : ''}`} id="dropzone" onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}><div className="file-icon" aria-hidden="true"><svg viewBox="0 0 48 56"><path d="M8 2h23l11 11v41H8z"/><path d="M31 2v12h11M16 25h17M16 32h17M16 39h10"/></svg></div><h2 id="drop-title">{file ? 'Your file is ready' : encode ? 'Start with your text' : 'Bring your text back'}</h2><p id="drop-description">{file ? 'Choose a different file, or continue below.' : encode ? 'A tiny model will learn this file.' : 'Drop a .nzip model archive here.'}</p><label className="button primary file-picker" htmlFor="file-input"><span>{file ? 'Change file' : encode ? 'Choose a text file' : 'Choose a model archive'}</span><input ref={fileInput} id="file-input" type="file" disabled={busy} accept={encode ? '.txt,.md,.csv,.json,.log,.xml,.html,.css,.js,.py,text/*,.nzip' : '.nzip'} aria-describedby="file-limit" onChange={event => chooseFile(event.target.files[0])}/></label><p className="fine-print" id="file-limit">{encode ? 'Text files up to 500 KB in your browser' : 'Model archives restoring up to 16 MiB'}</p></div>{file ? <div className="selected-file" id="selected-file"><div><span className="file-chip" aria-hidden="true">{encode ? 'TXT' : 'NZIP'}</span><div><strong id="file-name">{file.name}</strong><span id="file-size">{format(file.size)}</span></div></div><button className="icon-button" id="remove-file" disabled={busy} aria-label="Remove selected file" onClick={() => changeAction(action)}>×</button></div> : null}<div className="samples" id="samples"><span>Try it first:</span>{encode ? <><button className="text-button" id="sample-text" disabled={busy} onClick={() => sample(false)}>Use Alice text</button><span className="sample-separator">·</span></> : null}<button className="text-button" id="sample-neural" disabled={busy} onClick={() => sample(true)}>Restore a sample model</button></div>{encode ? <div className="encode-options" id="encode-options"><label htmlFor="training-budget">Training time</label><div className="option-controls"><select id="training-budget" disabled={busy} value={seconds} onChange={event => setSeconds(event.target.value)}><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option></select></div><p id="mode-description">Encoding trains a model. The archive always includes its weights and lossless stream. Writing and verification take additional time.</p></div> : <p className="method-note">Decoding uses the saved model. There is no retraining.</p>}<div className="action-row"><button className="button primary run-button" id="run-button" disabled={busy || !file} onClick={() => runJob()}>{busy ? encode ? 'Encoding…' : 'Decoding…' : encode ? 'Encode file' : 'Decode archive'}</button>{busy ? <button className="button secondary" id="cancel-button" onClick={cancel}>Cancel</button> : null}<span>{busy ? 'Cancel at any time.' : file ? 'Your original stays untouched.' : 'Choose a file to begin.'}</span></div>{error ? <div className="error-message" id="error-message" role="alert">{error}</div> : null}</div><div className="output-side" id="output-side"><div className="output-heading"><span>{encode ? 'Your model archive' : 'Your restored file'}</span>{result ? <span className="output-method">MODEL + STREAM</span> : null}</div>{busy && progress ? <ProgressPanel event={progress} started={started.current}/> : result ? <Result result={result} downloadRef={download}/> : <div className="output-empty" id="output-empty"><svg viewBox="0 0 56 56" aria-hidden="true"><path d="M10 17h36v30H10zM7 9h42v8H7zM22 26h12"/></svg><h3>Your words, in a model.</h3><p>Weights + an encoded stream.<br/>One archive. Every byte comes back.</p></div>}</div></div><div className="workbench-bottom"><span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9"/></svg>Always lossless</span><span>Model-based compression. No file uploads.</span></div><p className="sr-only" id="announcer" role="status" aria-live="polite" aria-atomic="true">{announcement}</p></section>;
}
