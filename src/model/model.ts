// Getting the weights: resolve the configured source, report whether they are stored in
// this browser, download and load them with progress, offload them, or load a local GGUF.
//
// The vendored runtime streams the GGUF by HTTP byte ranges and stores each range in its
// IndexedDB cache ("gguf-cache-v1", keyed by URL), so a second visit loads from disk.
import './raf-shim.ts';
import { Lfm3ForCausalLM } from '../../vendor/lfm3-webgpu-pi/Lfm3ForCausalLM.js';
import type { LoadOptions, LoadProgress } from '../../vendor/lfm3-webgpu-pi/Lfm3ForCausalLM.js';
import { MODEL, contextTokens } from './config.ts';

const CACHE_DB = 'gguf-cache-v1';

export type Model = Lfm3ForCausalLM;

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

// Delete cached copies of the same file under other URLs (an older pin, or the unpinned "main"
// URL that served the previous model), so a model update does not leave 1 GB behind.
export async function pruneStale(url: string): Promise<string[]> {
  const name = url.split('/').pop();
  const db = await openCache();
  if (!db || !db.objectStoreNames.contains('meta')) { db?.close(); return []; }
  const keys = await new Promise<string[]>((resolve) => {
    const req = db.transaction('meta').objectStore('meta').getAllKeys();
    req.onsuccess = () => resolve(req.result.filter((k): k is string => typeof k === 'string'));
    req.onerror = () => resolve([]);
  });
  db.close();
  const stale = keys.filter((k) => k !== url && k.split('/').pop() === name);
  for (const k of stale) await offload(k);
  return stale;
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
export async function load({ url, file = null, onProgress = () => {} }: {
  url: string;
  file?: File | null;
  onProgress?: (progress: Progress) => void;
}): Promise<Model> {
  const options: LoadOptions = {
    maxLength: contextTokens(),
    onProgress: (p: LoadProgress) => {
      if (p.status === 'weights' && p.kind === 'bytes') onProgress({ phase: 'download', loaded: p.loaded, total: p.total, message: p.message });
      else if (p.status === 'weights' && p.kind === 'tensors') onProgress({ phase: 'gpu', loaded: p.loaded, total: p.total, message: p.message });
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
  return Lfm3ForCausalLM.from_pretrained(source, options);
}
