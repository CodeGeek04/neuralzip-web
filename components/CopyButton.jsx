'use client';
import { useState } from 'react';
export default function CopyButton({ text }) {
  const [label, setLabel] = useState('Copy commands');
  return <button className="copy-button" id="copy-install" aria-label="Copy installation and usage commands" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setLabel('Copied'); }
    catch { setLabel('Select the commands below'); }
  }}>{label}</button>;
}
