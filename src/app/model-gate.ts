// The model in the Chart assistant, without UI: mirrors the model host's status into app.model
// (setModel, so every view re-renders on the `model` event), says phase changes to screen
// readers, and offers the actions and progress wording the React views use (src/chat/model/).
//
// The runtime is imported lazily (src/chart/model-host.ts pulls in ~1 MB of WebGPU code), so the
// page and its data render first.
import { app, on, setModel } from './state.ts';
import type { ModelStatus } from './state.ts';
import { announce } from './dom.ts';
import { MODEL_FILE } from '../model/config.ts';
import type { DeviceCheck } from '../chart/model-host.ts';

export type { DeviceCheck };
type Host = typeof import('../chart/model-host.ts');
let hostPromise: Promise<Host> | null = null;
let hostNow: Host | null = null;
export const getHost = (): Promise<Host> => (hostPromise ??= import('../chart/model-host.ts').then((host) => (hostNow = host)));
/** The host once loaded (for its `source`), else null. */
export const host = (): Host | null => hostNow;

/** Arrived from the landing page's "Use a local GGUF…": offer the file first. */
export const preferLocal = new URLSearchParams(location.search).has('local');

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** 1.10 GB, 412 MB. */
export const fmtBytes = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(0) + ' MB');
/** 1.1 GB: the short form for copy. */
export const fmtSize = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB');

let knownSize: number | null = null;
/** The weights' size (from the server once known, else the configured file's). */
export const modelBytes = (): number => knownSize ?? MODEL_FILE.bytes;

export const percent = (s: Extract<ModelStatus, { state: 'loading' }>): number | null =>
  s.total ? Math.max(0, Math.min(100, (100 * s.loaded) / s.total)) : null;

// ---------- actions ----------
export function download(): void {
  void getHost().then((h) => h.startModel({ download: true })).catch(() => { /* shown by the status */ });
}
export function loadFile(file: File): void {
  void getHost().then((h) => h.startModel({ file })).catch(() => { /* shown by the status */ });
}
/** Bytes of weights stored in this browser. */
export const storedBytes = (): Promise<number> => getHost().then((h) => h.storedNow());
/** Unload and delete the weights; returns bytes freed. */
export async function removeModel(): Promise<number> {
  const h = await getHost();
  const freed = await h.removeModel();
  announce(`Removed from this browser${freed ? `; ${fmtBytes(freed)} freed` : ''}.`);
  return freed;
}
export const deviceChecks = (): Promise<DeviceCheck[]> => getHost().then((h) => h.deviceChecks());

// ---------- progress wording ----------
export type Origin = ReturnType<Host['loadInfo']>;
let origin: Origin = { from: 'network' };
export const loadOrigin = (): Origin => origin;

export interface ProgressView { title: string; line: string; percent: number | null }
/** "Downloading · 412 MB of 1.10 GB", "Preparing on the GPU…", "Loading the model from this browser…". */
export function progressView(s: Extract<ModelStatus, { state: 'loading' }>): ProgressView {
  const p = percent(s);
  if (s.phase === 'gpu') return { title: 'Preparing on the GPU…', line: 'Almost ready', percent: p };
  if (s.phase === 'download') {
    const amount = s.total ? ` · ${fmtBytes(s.loaded)} of ${fmtBytes(s.total)}` : '';
    if (origin.from === 'cache') return { title: 'Loading the model from this browser…', line: `Loading${amount}`, percent: p };
    if (origin.from === 'file') return { title: `Reading ${origin.fileName ?? 'your file'}…`, line: `Reading${amount}`, percent: p };
    return { title: 'Downloading the model', line: `Downloading${amount}`, percent: p };
  }
  return { title: origin.from === 'cache' ? 'Loading the model from this browser…' : 'Starting…', line: s.message ? `${s.message}…` : 'Starting…', percent: null };
}

// ---------- init ----------
let started = false;
let lastPhase = '';
/** Start mirroring the host's status into app.model and load cached weights (once per page). */
export function initModel(): void {
  if (started) return;
  started = true;
  setModel({ state: 'checking' });
  on('model', (s) => {
    // Short spoken updates on phase changes only (not every percent).
    const phase = s.state === 'loading' ? `loading-${s.phase}` : s.state;
    if (phase === lastPhase) return;
    lastPhase = phase;
    if (s.state === 'ready') announce('The model is ready.');
    else if (s.state === 'loading' && s.phase === 'download') announce(origin.from === 'network' ? 'Downloading the model.' : 'Loading the model.');
    else if (s.state === 'loading' && s.phase === 'gpu') announce('Preparing the model on the GPU.');
    else if (s.state === 'error') announce('The model did not load.');
  });
  getHost().then((h) => {
    h.subscribe((s) => { origin = h.loadInfo(); setModel(s); });
    void h.remoteBytes().then((r) => { if (r.ok && r.bytes) { knownSize = r.bytes; setModel(app.model); } });
    // Weights already in this browser (or named by ?model=) load at once, in seconds.
    void h.startModel().catch(() => { /* shown by the status */ });
  }).catch((error: unknown) => setModel({ state: 'error', message: 'Could not load the WebGPU runtime: ' + errorText(error) }));
}

/** This device reports little memory (Chrome reports at most 8 GB): the model may not fit. */
export function lowMemory(): number | null {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof gb === 'number' && gb < 8 ? gb : null;
}
