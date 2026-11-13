// Getting the weights: resolve the configured source, report whether they are stored in
// this browser, download and load them with progress, offload them, or load a local GGUF.
//
// The vendored runtime streams the GGUF by HTTP byte ranges and stores each range in its
// IndexedDB cache ("gguf-cache-v1", keyed by URL), so a second visit loads from disk.
import './raf-shim.ts';
import { Lfm3ForCausalLM } from '../../vendor/lfm3-webgpu-pi/Lfm3ForCausalLM.js';
import type { ChatSession, LoadOptions, LoadProgress } from '../../vendor/lfm3-webgpu-pi/Lfm3ForCausalLM.js';
import { MODEL, activeRuntime, contextTokens } from './config.ts';
import { hubRepo, modelVersion, replaces } from './versions.ts';

export { hubRepo, modelVersion };

const CACHE_DB = 'gguf-cache-v1';

/** What the page uses of a loaded model, which both runtimes (config.ts, MODEL_RUNTIME) provide. */
export interface Model {
  create_session(): ChatSession;
  dispose(): Promise<void>;
}

/** Where the weights come from: the URL the runtime fetches, a label, and a page to link. */
export interface ModelSource {
  url: string;
  label: string;
  page: string | null;
}

export type SizeResult = { ok: true; bytes: number | null } | { ok: false; status: number | string };

/** Load progress, simplified: bytes downloaded, then tensors prepared on the GPU. */
export interface Progress {
  phase: 'download' | 'gpu' | 'other';
  loaded?: number;
  total?: number | null;
  message?: string;
}

// "owner/repo/file.gguf" or "owner/repo@revision/file.gguf" -> Hugging Face resolve URL (the
// revision, a commit sha, pins the exact file; it also keys the browser cache, so a new pin
// downloads afresh); a relative or absolute URL as is.
export function resolveSource(spec: string = new URLSearchParams(location.search).get('model') || MODEL): ModelSource {
  if (/^https?:\/\//.test(spec)) return { url: spec, label: spec, page: spec };
  const parts = spec.split('/');
  if (parts.length >= 3 && !spec.startsWith('.') && !spec.startsWith('/') && parts[0] !== 'models') {
    const [owner, repoAt, ...file] = parts;
    const [repo, revision = 'main'] = repoAt.split('@');
    return {
      url: `https://huggingface.co/${owner}/${repo}/resolve/${revision}/${file.join('/')}`,
      label: `${owner}/${repo} · ${file.join('/')}`,
      page: `https://huggingface.co/${owner}/${repo}`,
    };
  }
  const url = new URL(spec, location.href).href;
  return { url, label: spec.split('/').pop() + ' (local server)', page: null };
}

// Size from a HEAD request (Hugging Face reports the file size through its redirect).
export async function remoteSize(url: string): Promise<SizeResult> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return { ok: false, status: res.status };
    const n = Number(res.headers.get('x-linked-size') || res.headers.get('content-length'));
    return { ok: true, bytes: Number.isFinite(n) && n > 0 ? n : null };
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.message : String(error) };
  }
}

async function openCache(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return null;
  const known = indexedDB.databases ? await indexedDB.databases() : null;
  if (known && !known.some((d) => d.name === CACHE_DB)) return null;
  return new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(CACHE_DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

// Bytes of this URL's weights held in the browser cache.
export async function storedBytes(url: string): Promise<number> {
  const db = await openCache();
  if (!db || !db.objectStoreNames.contains('chunks')) { db?.close(); return 0; }
  return new Promise<number>((resolve) => {
    let total = 0;
    const req = db.transaction('chunks').objectStore('chunks').openCursor(IDBKeyRange.bound([url], [url, [], []]));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { db.close(); resolve(total); return; }
      const [, begin, end] = cursor.key as [string, unknown, unknown];  // [url, begin, end]
      if (typeof begin === 'number' && typeof end === 'number') total += end - begin;
      cursor.continue();
    };
    req.onerror = () => { db.close(); resolve(total); };
  });
}

// Delete this URL's weights from the browser. Returns bytes freed (by the browser's estimate).
export async function offload(url: string): Promise<number> {
  const before = (await navigator.storage?.estimate?.())?.usage ?? 0;
  const db = await openCache();
  if (db) {
    await new Promise<void>((resolve) => {
      const stores = ['chunks', 'meta'].filter((s) => db.objectStoreNames.contains(s));
      if (!stores.length) { resolve(); return; }
      const tx = db.transaction(stores, 'readwrite');
      if (stores.includes('chunks')) tx.objectStore('chunks').delete(IDBKeyRange.bound([url], [url, [], []]));
      if (stores.includes('meta')) tx.objectStore('meta').delete(url);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
    db.close();
  }
  const after = (await navigator.storage?.estimate?.())?.usage ?? before;
  return Math.max(0, before - after);
}

/** A model whose weights are (partly) stored in this browser. */
export interface SavedModel { url: string; file: string; version: number | null; bytes: number }

/** Every model stored in this browser, with its bytes (one pass over the cache's keys). */
export async function savedModels(): Promise<SavedModel[]> {
  const db = await openCache();
  if (!db || !db.objectStoreNames.contains('chunks')) { db?.close(); return []; }
  const bytes = new Map<string, number>();
  await new Promise<void>((resolve) => {
    const req = db.transaction('chunks').objectStore('chunks').openKeyCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(); return; }
      const [url, begin, end] = cursor.key as [unknown, unknown, unknown];
      if (typeof url === 'string' && typeof begin === 'number' && typeof end === 'number') bytes.set(url, (bytes.get(url) ?? 0) + end - begin);
      cursor.continue();
    };
    req.onerror = () => resolve();
  });
  db.close();
  return [...bytes].filter(([, n]) => n > 0).map(([url, n]) => {
    const file = url.split('/').pop() ?? url;
    return { url, file, version: modelVersion(file), bytes: n };
  });
}

/**
 * Saved models that `url` replaces: other versions or revisions of the same quantization from the same
 * Hugging Face repo (v2 Q4_K_M for v3 Q4_K_M, an older pin of the same file). The picker's other
 * quantizations (catalog.ts) live in the same repo but are kept: the visitor removes them one by one.
 */
export async function replacedBy(url: string): Promise<SavedModel[]> {
  return (await savedModels()).filter((m) => replaces(url, m.url));
}

// Delete the models `url` replaces (an older version, an older pin, or the unpinned "main" URL),
// so an update does not leave 1 GB behind. Returns the URLs removed.
export async function pruneStale(url: string): Promise<string[]> {
  const stale = (await replacedBy(url)).map((m) => m.url);
  for (const k of stale) await offload(k);
  return stale;
}

/** The newest model file in a Hugging Face repo (highest "-v<N>" .gguf on its main branch), or null. */
export async function latestOnHub(repo: string): Promise<{ version: number; file: string } | null> {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${repo}`);
    if (!res.ok) return null;
    const info = await res.json() as { siblings?: { rfilename?: string }[] };
    let best: { version: number; file: string } | null = null;
    for (const s of info.siblings ?? []) {
      const file = s.rfilename ?? '';
      const version = /\.gguf$/i.test(file) ? modelVersion(file) : null;
      if (version !== null && (!best || version > best.version)) best = { version, file };
    }
    return best;
  } catch {
    return null;
  }
}

// A local GGUF behind a fetch() that answers HEAD and byte ranges from File.slice(), so
// the runtime reads it exactly like a remote file, without copying it into the cache.
function fileFetch(file: File): (url: string, init?: RequestInit) => Promise<Response> {
  const tag = `"${file.size}-${file.lastModified}"`;
  return async (_url: string, init: RequestInit = {}) => {
    if ((init.method || 'GET').toUpperCase() === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-length': String(file.size), 'accept-ranges': 'bytes', etag: tag } });
    }
    const m = /bytes=(\d+)-(\d*)/.exec(new Headers(init.headers).get('range') || '');
    if (m) {
      const start = Number(m[1]);
      const end = Math.min(m[2] ? Number(m[2]) : file.size - 1, file.size - 1);
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${file.size}`, 'content-length': String(end - start + 1), etag: tag },
      });
    }
    return new Response(file, { status: 200, headers: { 'content-length': String(file.size), etag: tag } });
  };
}

// Load the model. onProgress gets {phase: 'download'|'gpu'|'other', loaded, total, message}.
export async function load({ url, file = null, onProgress = () => {}, onActivity = () => {}, signal }: {
  url: string;
  file?: File | null;
  onProgress?: (progress: Progress) => void;
  /** Called whenever the load makes headway: a progress event or bytes arriving (the stall watchdog). */
  onActivity?: () => void;
  /** Aborts the load (its fetches; the runtime stops at its next read). */
  signal?: AbortSignal;
}): Promise<Model> {
  let bytes: { loaded: number; total: number | null } = { loaded: 0, total: null };
  const options: LoadOptions = {
    maxLength: contextTokens(),
    signal,
    onProgress: (p: LoadProgress) => {
      onActivity();
      if (p.status === 'weights' && p.kind === 'bytes') {
        bytes = { loaded: p.loaded ?? 0, total: p.total ?? null };
        onProgress({ phase: 'download', loaded: p.loaded, total: p.total, message: p.message });
      } else if (p.status === 'weights' && p.kind === 'tensors') {
        // The lowbit runtime uploads tensors while it downloads: stay on the download until it is done.
        if (bytes.total === null || bytes.loaded >= bytes.total) onProgress({ phase: 'gpu', loaded: p.loaded, total: p.total, message: p.message });
      }
      else onProgress({ phase: 'other', message: p.message });
    },
  };
  let source = url;
  if (file) {
    if (!/\.gguf$/i.test(file.name)) throw new Error('Choose a .gguf file');
    source = `https://local-file.invalid/${encodeURIComponent(file.name)}`;
    Object.assign(options, { fetch: fileFetch(file), cache: false });
  } else {
    await navigator.storage?.persist?.().catch(() => {});  // ask not to evict ~1 GB of weights
  }
  if (activeRuntime() === 'lowbit') {
    await cacheAtVendoredVersion();
    // Watch the bytes themselves too (headway for the stall watchdog while the loader retries a block),
    // and make sure the signal reaches every range request. The runtime reports byte progress itself.
    options.fetch = watchedFetch(options.fetch ?? globalThis.fetch.bind(globalThis), signal, onActivity);
    const lowbit = await import('../../vendor/lfm3-lowbit/lfm3.js');
    return lowbit.Lfm3ForCausalLM.from_pretrained(source, options);
  }
  return Lfm3ForCausalLM.from_pretrained(source, options);
}

// Both runtimes keep weights in gguf-cache-v1 (stores "chunks" keyed [url, begin, end] and "meta"
// keyed url). The vendored runtime opens it at version 2 and the lowbit runtime at whatever version
// exists, creating version 1 when there is none; a later version-2 upgrade by the vendored runtime
// would then be blocked by the lowbit runtime's open connection. Creating it at version 2 first
// (the same two stores, as the vendored runtime would) keeps one version for both.
function cacheAtVendoredVersion(): Promise<void> {
  if (!('indexedDB' in globalThis)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const req = indexedDB.open(CACHE_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ['chunks', 'meta']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = req.onblocked = () => resolve();  // a newer version, or open elsewhere: leave it to the runtime
  });
}

/**
 * `fetchFn` with `signal` added to every request (with the request's own signal, which the lowbit
 * loader uses for its per-request timeouts), calling `onActivity` as each response's bytes arrive.
 */
function watchedFetch(
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>, signal: AbortSignal | undefined, onActivity: () => void,
): (input: string, init?: RequestInit) => Promise<Response> {
  return async (input, init = {}) => {
    const signals = [init.signal, signal].filter((x): x is AbortSignal => !!x);
    const res = await fetchFn(input, { ...init, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] });
    onActivity();
    if (!res.body) return res;
    const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, out) { onActivity(); out.enqueue(chunk); } }));
    return new Response(counted, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}
