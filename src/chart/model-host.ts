// The in-browser model, shared by the pages: one load at a time, with its status published to
// subscribers (the Chart assistant's model gate and status chip, the landing page). No DOM here.
//
// api.ts imports this module lazily (`await import('./model-host.ts')`) so the chart page and its
// data do not wait for the WebGPU runtime; the model gate does the same.
import { resolveSource, remoteSize, storedBytes, offload, load, pruneStale, replacedBy, latestOnHub, hubRepo, modelVersion, savedModels } from '../model/model.ts';
import type { Model, SavedModel, SizeResult } from '../model/model.ts';
import { MODEL_FACTS, MODEL_FILE, MODEL_OPTION, activeRuntime } from '../model/config.ts';
import { MODEL_OPTIONS } from '../model/catalog.ts';
import type { ModelOption } from '../model/catalog.ts';
import type { ModelStatus } from '../app/state.ts';  // type only: keeps this module free of the app's state

export type { ModelStatus };

declare global {
  interface Navigator { deviceMemory?: number }
}

/** Where the weights come from (the configured MODEL, or the page's ?model= override). */
export const source = resolveSource();
export const modelName = `${MODEL_FACTS.name} · ${source.label}`;
/** The page named its own weights (?model=): load them without asking. */
export const overridden = !!new URLSearchParams(location.search).get('model');
/** The configured file's size (MODEL_FILE); null when ?model= names other weights (ask the server). */
export const expectedBytes: number | null = overridden ? null : MODEL_FILE.bytes;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A load failure in words a visitor can act on: memory, storage, network, or the GPU going away.
 * The runtime's own message follows in brackets, for whoever debugs it.
 */
export function loadErrorText(error: unknown): string {
  const raw = errorText(error);
  const name = error instanceof Error ? error.name : '';
  const lower = raw.toLowerCase();
  const say = (text: string) => `${text} (${raw.slice(0, 200)})`;
  if (name === 'StallError') return raw;
  if (name === 'QuotaExceededError' || /quota|storage.*full|no space/.test(lower)) {
    return say('This browser has no room to store the model (about 1.1 GB). Free some disk space, or allow this site more storage, and try again.');
  }
  if (/out of memory|outofmemory|allocation|alloc failed|too large|exceeds the (max|limit)|maxbuffersize|maxstoragebuffer/.test(lower)) {
    return say('This device does not have enough GPU memory for the model (it needs about 3 GB). Close other tabs and apps, and try again.');
  }
  if (/device (was )?lost|gpudevicelost|context lost/.test(lower)) {
    return say('The GPU stopped responding while the model loaded, often because memory ran short. Close other tabs, then try again.');
  }
  if (/failed to fetch|networkerror|network error|load failed|http (4|5)\d\d|status (4|5)\d\d|\b(403|404|429|500|502|503)\b/.test(lower)) {
    return say('The download stopped. Check the connection and try again; what was already downloaded is kept.');
  }
  return raw;
}

/** 1.10 GB, 412 MB. */
export const fmtBytes = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(0) + ' MB');
/** 1.1 GB: the short form for buttons and copy. */
export const fmtSize = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB');

// ---------- status ----------
let status: ModelStatus = { state: 'checking' };
const listeners = new Set<(s: ModelStatus) => void>();
let lastEmit = 0;
function publish(next: ModelStatus): void {
  // Progress arrives in bursts; pass on at most ~12 updates a second within one phase.
  const now = performance.now();
  if (next.state === 'loading' && status.state === 'loading' && next.phase === status.phase
    && now - lastEmit < 80 && (next.total === null || next.loaded < next.total)) { status = next; return; }
  status = next;
  lastEmit = now;
  for (const fn of listeners) {
    try { fn(next); } catch (error) { console.error('[model status]', error); }
  }
}
/** Listen to the model's status; called at once with the current one. Returns an unsubscribe function. */
export function subscribe(fn: (s: ModelStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => { listeners.delete(fn); };
}
export const currentStatus = (): ModelStatus => status;

/** Where the current (or last) load reads from: the network, this browser's storage, or a local file. */
let origin: { from: 'network' | 'cache' | 'file'; fileName?: string } = { from: 'network' };
export const loadInfo = (): typeof origin => origin;

// ---------- size and storage ----------
let sizePromise: Promise<SizeResult> | null = null;
/** The weights' size from a HEAD request (asked once). */
export function remoteBytes(): Promise<SizeResult> {
  sizePromise ??= remoteSize(source.url);
  return sizePromise;
}
export const storedNow = (): Promise<number> => storedBytes(source.url);

// ---------- versions ----------
/** This page's model version (the "-v<N>" in its file name), or null. */
export const version: number | null = modelVersion(source.url);
/** What this browser has saved that the page's model replaces: an older version or pin (biggest first). */
export const replaced = async (): Promise<SavedModel[]> =>
  overridden ? [] : (await replacedBy(source.url)).sort((a, b) => b.bytes - a.bytes);
/** Delete a saved model this page's model replaces (never another site's or the current one). */
export async function removeSaved(url: string): Promise<number> {
  if (!(await replaced()).some((m) => m.url === url)) return 0;
  return offload(url);
}
let hubPromise: Promise<{ version: number; file: string } | null> | null = null;
/** The newest model version on Hugging Face (asked once), or null when unknown. */
export function latest(): Promise<{ version: number; file: string } | null> {
  const repo = hubRepo(source.url);
  hubPromise ??= repo ? latestOnHub(repo) : Promise.resolve(null);
  return hubPromise;
}

// ---------- the picker's options ----------
/** A model the picker offers, with what this browser holds of it. */
export interface OptionState {
  option: ModelOption;
  /** The URL its weights are fetched from and cached under. */
  url: string;
  /** Bytes of it stored in this browser. */
  stored: number;
  /** It is the model this page runs. */
  current: boolean;
}
/** Every option, with its stored bytes (one pass over the cache). */
export async function optionStates(): Promise<OptionState[]> {
  const saved = new Map((await savedModels()).map((m) => [m.url, m.bytes]));
  return MODEL_OPTIONS.map((option) => {
    const url = resolveSource(option.spec).url;
    const current = !overridden && option.id === MODEL_OPTION.id;
    return { option, url, stored: saved.get(url) ?? 0, current };
  });
}
/** Delete one option's weights from this browser (the running model is unloaded first). Returns bytes freed. */
export async function removeOption(id: ModelOption['id']): Promise<number> {
  const state = (await optionStates()).find((o) => o.option.id === id);
  if (!state) return 0;
  if (state.current) return removeModel();
  return offload(state.url);
}

/**
 * Is the model usable here, and are its weights in this browser? Publishes `unsupported` or
 * `absent` (with the remote size once known); for `cached` it leaves the status alone, so a page
 * can decide whether to load.
 */
export async function probe(): Promise<{ state: 'cached' | 'absent' | 'unsupported'; stored: number }> {
  if (!navigator.gpu) {
    publish({ state: 'unsupported', reason: NO_WEBGPU });
    return { state: 'unsupported', stored: 0 };
  }
  // WebGPU can exist with no usable GPU (a blocklisted driver, a VM, "Use graphics acceleration" off).
  adapterOk ??= navigator.gpu.requestAdapter().then((a) => a !== null, () => false);
  if (!(await adapterOk)) {
    publish({ state: 'unsupported', reason: NO_ADAPTER });
    return { state: 'unsupported', stored: 0 };
  }
  const stored = await storedNow();
  if (stored > 0) return { state: 'cached', stored };
  if (status.state === 'checking' || status.state === 'absent') {
    publish({ state: 'absent', bytes: null });
    void remoteBytes().then((r) => {
      if (status.state === 'absent') publish({ state: 'absent', bytes: r.ok ? r.bytes : null });
    });
  }
  return { state: 'absent', stored };
}

const NO_WEBGPU = 'This browser has no WebGPU, so the model cannot run here. Use a recent Chrome or Edge on a laptop or desktop.';
const NO_ADAPTER = 'This browser has WebGPU, but no GPU is available to it (graphics acceleration may be off, or this GPU is not supported). Try Chrome or Edge with hardware acceleration on.';
let adapterOk: Promise<boolean> | null = null;

// ---------- loading ----------
let current: Model | null = null;
let loading: Promise<Model> | null = null;
let deciding: Promise<Model | null> | null = null;

/**
 * A load with no headway (no progress event, no bytes) for this long is stopped and reported. The lowbit
 * loader retries a stalled block itself (6 tries with backoff, about 150 s at worst) and fails with its own
 * error, so it gets longer; the vendored runtime does not retry.
 */
export const stallMs = (): number => (activeRuntime() === 'lowbit' ? 180_000 : 60_000);
export class StallError extends Error {
  constructor(ms: number) {
    super(`The download stopped: nothing arrived for ${Math.round(ms / 1000)} seconds. Check the connection and try again; what was already downloaded is kept.`);
    this.name = 'StallError';
  }
}

function begin(file: File | null): Promise<Model> {
  const previous = loading;
  const t0 = performance.now();
  const abort = new AbortController();
  let lastActivity = Number.POSITIVE_INFINITY;  // the clock starts once an earlier load has settled
  const touch = () => { lastActivity = performance.now(); };
  publish({ state: 'loading', phase: 'other', loaded: 0, total: null, message: file ? `Reading ${file.name}` : 'Starting' });
  const run = (async () => {
    if (previous) await previous.catch(() => null);
    touch();
    if (current) { await current.dispose(); current = null; }
    if (file) origin = { from: 'file', fileName: file.name };
    else {
      // From this browser only when (nearly) all of it is stored; a partial download resumes over the network.
      const have = await storedNow();
      origin = { from: have > 0 && (expectedBytes === null || have >= expectedBytes * 0.98) ? 'cache' : 'network' };
    }
    return load({
      url: source.url,
      file,
      signal: abort.signal,
      onActivity: touch,
      onProgress: (p) => publish({ state: 'loading', phase: p.phase, loaded: p.loaded ?? 0, total: p.total ?? null, message: p.message }),
    });
  })();
  // The watchdog: a load that makes no headway for stallMs() is aborted and fails, so the page offers
  // Try again instead of waiting forever. A model that arrives after that is let go.
  let timer: ReturnType<typeof setInterval> | undefined;
  const limit = stallMs();
  const stalled = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      if (performance.now() - lastActivity < limit) return;
      clearInterval(timer);
      abort.abort(new StallError(limit));
      reject(new StallError(limit));
    }, 2_000);
  });
  run.then((model) => { if (abort.signal.aborted) void model.dispose(); }, () => {}).finally(() => clearInterval(timer));
  const tracked: Promise<Model> = Promise.race([run, stalled]).then((model) => {
    current = model;
    // The swap: once this version is ready, delete what it replaces (an older version or pin).
    if (!file && !overridden && /^https?:/.test(source.url)) pruneStale(source.url).then((gone) => { if (gone.length) publish(status); }).catch(() => {});
    publish({ state: 'ready', seconds: (performance.now() - t0) / 1000 });
    return model;
  }, (error: unknown) => {
    if (loading === tracked) loading = null;
    console.error('[model] load failed', error);
    publish({ state: 'error', message: loadErrorText(error) });
    throw error;
  });
  loading = tracked;
  return tracked;
}

/**
 * The model, loading it if needed (one shared load). Without `download` it loads only when the
 * weights are already in this browser (or ?model= names them) and otherwise returns null, as it
 * does without WebGPU. `download` fetches them (about 1.1 GB, stored for next time); `file` loads
 * a local GGUF instead (read in place, not stored).
 */
export function startModel(opts: { download?: boolean; file?: File | null } = {}): Promise<Model | null> {
  if (!navigator.gpu) {
    publish({ state: 'unsupported', reason: NO_WEBGPU });
    return Promise.resolve(null);
  }
  if (opts.file) return begin(opts.file);
  if (loading) return loading;
  if (opts.download) return begin(null);
  deciding ??= (async (): Promise<Model | null> => {
    const found = await probe();
    if (loading) return loading;
    if (found.state === 'unsupported' || (found.state === 'absent' && !overridden)) return null;
    return begin(null);
  })().finally(() => { deciding = null; });
  return deciding;
}

/** Unload the model and delete its weights from this browser. Returns bytes freed (the browser's estimate). */
export async function removeModel(): Promise<number> {
  const pending = loading;
  loading = null;
  if (pending) await pending.catch(() => null);
  if (current) { await current.dispose(); current = null; }
  const freed = await offload(source.url);
  publish({ state: 'absent', bytes: null });
  const size = await remoteBytes();
  if (status.state === 'absent') publish({ state: 'absent', bytes: size.ok ? size.bytes : null });
  return freed;
}

// ---------- this device ----------
export interface DeviceCheck { ok: boolean | null; name: string; detail: string }

/** What this browser offers the model: WebGPU adapter, 16-bit shaders, storage, memory. */
export async function deviceChecks(): Promise<DeviceCheck[]> {
  const items: DeviceCheck[] = [];
  if (!navigator.gpu) items.push({ ok: false, name: 'WebGPU', detail: 'Not available. Use a recent Chrome or Edge on a laptop or desktop.' });
  else {
    const adapter = await navigator.gpu.requestAdapter().catch(() => null);
    if (!adapter) items.push({ ok: false, name: 'WebGPU', detail: 'No GPU adapter was granted.' });
    else {
      const info = adapter.info;
      items.push({ ok: true, name: 'WebGPU', detail: [info?.vendor, info?.architecture].filter(Boolean).join(' · ') || 'Available' });
      const f16 = adapter.features.has('shader-f16');
      // The lowbit runtime uses core WGSL only, so it runs the same without 16-bit shaders.
      if (activeRuntime() === 'lowbit') items.push({ ok: true, name: '16-bit shaders', detail: f16 ? 'Supported' : 'Not needed by this model' });
      else items.push({ ok: f16 ? true : null, name: '16-bit shaders', detail: f16 ? 'Supported' : 'Not supported; expect slower answers' });
    }
  }
  if (navigator.storage?.estimate) {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    items.push({ ok: quota - usage > 1.5e9, name: 'Storage', detail: `${fmtBytes(quota - usage)} free for this site; the weights need about 1.1 GB` });
  }
  if (navigator.deviceMemory) {
    items.push({ ok: navigator.deviceMemory >= 8 ? true : null, name: 'Memory', detail: `${navigator.deviceMemory} GB or more; the demo peaks near 3.2 GB` });
  }
  return items;
}
