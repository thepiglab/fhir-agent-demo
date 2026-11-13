// lfm3.js — LFM3 on WebGPU with 1–4-bit GGUF weights (Q1_0, Q2_0, TQ2_0, Q2_K–Q6_K, Q8_0), as a drop-in for the
// subset of the vendored `Lfm3ForCausalLM` API that fhir-agent-demo uses:
//   const model = await Lfm3ForCausalLM.from_pretrained(url, { maxLength, onProgress, fetch, cache });
//   const session = model.create_session();
//   const turn = session.generate(messages, { tools, enable_thinking, max_new_tokens, temperature, top_k, seed,
//                                             repetition_penalty, ... });
//   for await (const ev of turn) { ev.type: 'prefill' | 'reasoning' | 'text' | 'tool_call' }
//   const { finish_reason, message, usage, timings } = await turn.result;
//
// The engine (wasm, `lfm3_web.js` from wasm-bindgen) does everything else: the GGUF header, streaming the
// weights onto the GPU one tensor at a time, the chat template, tokenizer, KV-prefix reuse across calls,
// sampling on the GPU, and parsing tool calls. Weights are cached by byte range in the demo's IndexedDB layout
// ("gguf-cache-v1": store `chunks` keyed [url, begin, end] holding the bytes, store `meta` keyed url), which the
// demo reads (stored bytes) and clears (offload) directly. Values are this runtime's tensor ranges.
import init, { Engine } from './pkg/lfm3_web.js';

export class BusyError extends Error { constructor(m = 'a generation is already running on this session') { super(m); this.name = 'BusyError'; } }
export class ContextOverflowError extends Error { constructor(m) { super(m); this.name = 'ContextOverflowError'; } }
export class DeviceLostError extends Error { constructor(m) { super(m); this.name = 'DeviceLostError'; } }

const CACHE_DB = 'gguf-cache-v1';
let wasmReady = null;

// Open the shared cache at whatever version it has; add the two stores (one version up) only if missing.
function openCache() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  const open = (version) => new Promise((resolve) => {
    const req = version ? indexedDB.open(CACHE_DB, version) : indexedDB.open(CACHE_DB);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return open().then((db) => {
    if (!db || (db.objectStoreNames.contains('chunks') && db.objectStoreNames.contains('meta'))) return db;
    const v = db.version + 1; db.close(); return open(v);
  });
}
const idb = (db, store, mode, f) => new Promise((resolve) => {
  try {
    const tx = db.transaction(store, mode); const r = f(tx.objectStore(store));
    tx.oncomplete = () => resolve(r?.result); tx.onerror = tx.onabort = () => resolve(undefined);
  } catch { resolve(undefined); }
});

/** Byte-range reader over HTTP (or a caller-supplied fetch), with an optional IndexedDB range cache. */
async function rangeReader(url, fetchFn, useCache) {
  let size = null, etag = null;
  const head = await fetchFn(url, { method: 'HEAD' });
  if (head.ok) {
    const n = Number(head.headers.get('x-linked-size') || head.headers.get('content-length'));
    if (Number.isFinite(n) && n > 0) size = n;
    etag = head.headers.get('x-linked-etag') || head.headers.get('etag');
  }
  const db = useCache ? await openCache() : null;
  if (db) {
    const meta = await idb(db, 'meta', 'readonly', (s) => s.get(url));
    if (meta && (meta.size !== size || (etag && meta.etag && meta.etag !== etag))) {   // file changed: drop its ranges
      await idb(db, 'chunks', 'readwrite', (s) => s.delete(IDBKeyRange.bound([url], [url, [], []])));
    }
    if (size == null && meta) size = meta.size;
    if (size != null) await idb(db, 'meta', 'readwrite', (s) => s.put({ size, etag, stored: Date.now() }, url));
  }
  // The file is cached in fixed 8 MB blocks (keys [url, begin, end]), so no single IndexedDB record is large and any
  // tensor range is served from whole blocks; a few recent blocks stay in memory for neighbouring tensors.
  const BLOCK = 8 << 20;
  const recent = new Map();
  const block = async (b) => {
    if (recent.has(b)) return recent.get(b);
    const begin = b * BLOCK, end = Math.min(begin + BLOCK, size ?? Infinity);
    const key = [url, begin, end];
    let bytes = db ? await idb(db, 'chunks', 'readonly', (s) => s.get(key)).then((v) => v && new Uint8Array(v)) : null;
    if (!bytes) {
      const res = await fetchFn(url, { headers: { Range: `bytes=${begin}-${end - 1}` } });
      if (!res.ok) throw new Error(`GET ${url} bytes ${begin}-${end - 1}: HTTP ${res.status}`);
      if (size == null) { const m = /\/(\d+)$/.exec(res.headers.get('content-range') || ''); if (m) size = Number(m[1]); }
      const buf = await res.arrayBuffer();
      bytes = res.status === 206 ? new Uint8Array(buf) : new Uint8Array(buf, begin, Math.min(BLOCK, buf.byteLength - begin));
      if (db) await idb(db, 'chunks', 'readwrite', (s) => s.put(bytes.slice().buffer, [url, begin, begin + bytes.length]));
    }
    recent.set(b, bytes); if (recent.size > 4) recent.delete(recent.keys().next().value);
    return bytes;
  };
  const read = async (offset, len) => {
    const out = new Uint8Array(len);
    for (let b = Math.floor(offset / BLOCK); b * BLOCK < offset + len; b++) {
      const bytes = await block(b), begin = b * BLOCK;
      const from = Math.max(offset, begin), to = Math.min(offset + len, begin + bytes.length);
      out.set(bytes.subarray(from - begin, to - begin), from - offset);
    }
    return out;
  };
  if (size == null) await block(0);     // learn the size from Content-Range
  return { read, size: () => size };
}

/** Async-iterable event stream with a result promise, like the vendored ChatTurn. */
class Turn {
  #q = []; #wake = null; #done = false; #cancel;
  constructor(run, cancel) {
    this.#cancel = cancel;
    this.result = run((ev) => { this.#q.push(ev); this.#wake?.(); }).finally(() => { this.#done = true; this.#wake?.(); });
    this.result.catch(() => {});
  }
  cancel() { this.#cancel(); }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.#q.length) { yield this.#q.shift(); continue; }
      if (this.#done) { await this.result; return; }
      await new Promise((r) => { this.#wake = r; }); this.#wake = null;
    }
  }
}

class ChatSession {
  #m; #busy = false;
  constructor(model) { this.#m = model; }
  get max_length() { return this.#m.engine.max_ctx(); }
  get_seq_length() { return this.#m.engine.seq_len(); }
  reset() { this.#m.engine.reset(); }
  async dispose() { this.#m.engine.reset(); }

  generate(messages, options = {}) {
    if (this.#busy) throw new BusyError();
    let cancelled = false;
    const engine = this.#m.engine;
    const run = async (emit) => {
      this.#busy = true;
      try {
        const tools = options.tools?.length ? JSON.stringify(options.tools) : null;
        const thinking = options.enable_thinking !== false;
        const prompt = engine.render_chat(JSON.stringify(messages), tools, thinking);
        const ids = engine.encode(prompt);
        const maxNew = options.max_new_tokens ?? 4096;
        if (ids.length + 1 > engine.max_ctx()) {
          throw new ContextOverflowError(`the conversation needs ${ids.length} tokens plus the reply, but the context holds ${engine.max_ctx()}`);
        }
        const eos = options.eos_token_id ?? this.#m.eos;
        const stopIds = (Array.isArray(eos) ? eos : [eos]).filter((x) => x != null);
        const params = { ...options, stop_ids: stopIds };
        for (const k of ['tools', 'signal', 'enable_thinking', 'max_new_tokens', 'eos_token_id', 'stop_strings']) delete params[k];
        const stopStrings = options.stop_strings || [];
        const stream = engine.new_stream(thinking, tools, Uint32Array.from(stopIds));   // decodes tokens, routes reasoning / text / tool markup
        emit({ type: 'prefill', done: 0, total: ids.length });
        let first = true; let text = '';
        const t0 = performance.now(); let ttft = 0;
        const onTokens = (toks) => {
          if (first) { first = false; ttft = performance.now() - t0; emit({ type: 'prefill', done: ids.length, total: ids.length }); }
          for (const ev of JSON.parse(stream.push(toks))) { if (ev.text) emit(ev); if (ev.type === 'text') text += ev.text; }
          if (stopStrings.some((s) => text.includes(s))) return false;
          return !(cancelled || options.signal?.aborted);
        };
        const r = await engine.generate(ids, JSON.stringify(params), maxNew, 8, onTokens);
        const tail = JSON.parse(stream.finish());
        for (const ev of tail) if (ev.text) emit(ev);
        // the prompt ended with "<think>" when thinking is on: give the parser the reply as the model saw it, so a reply
        // cut off inside its reasoning stays reasoning
        const parsed = JSON.parse(engine.parse_reply((thinking ? '<think>' : '') + stream.full_text(), tools));
        const tool_calls = parsed.tool_calls.map((c, i) => ({
          id: `call_${Date.now().toString(36)}_${i}`, type: 'function', function: { name: c.name, arguments: c.arguments },
          ...(c.errors?.length ? { errors: c.errors } : {}),
        }));
        for (const c of tool_calls) emit({ type: 'tool_call', tool_call: c });
        const message = { role: 'assistant', content: parsed.content || null };
        if (parsed.reasoning != null) message.reasoning_content = parsed.reasoning;
        if (tool_calls.length) message.tool_calls = tool_calls;
        const stoppedByString = stopStrings.some((s) => text.includes(s));
        const finish_reason = r.finish === 'length' ? 'length'
          : (r.finish === 'cancelled' && !stoppedByString) ? 'cancelled' : tool_calls.length ? 'tool_calls' : 'stop';
        const n = r.tokens.length;
        return {
          _debug: { prompt_ids: Array.from(ids), tokens: Array.from(r.tokens) },
          finish_reason, message,
          usage: { prompt_tokens: ids.length, cached_tokens: r.cached_tokens, completion_tokens: n, reasoning_tokens: stream.reasoning_tokens() },
          timings: { ttft_ms: ttft, decode_ms: r.decode_ms, tokens_per_second: n > 1 ? (n - 1) / (r.decode_ms / 1000) : 0,
                     prefill_ms: r.prefill_ms, prefill_tokens_per_second: (ids.length - r.cached_tokens) / (r.prefill_ms / 1000) },
        };
      } finally { this.#busy = false; }
    };
    return new Turn(run, () => { cancelled = true; });
  }
}

export class Lfm3ForCausalLM {
  constructor(engine, info) { this.engine = engine; this.info = info; this.eos = engine.token_id('<|im_end|>'); }

  static async from_pretrained(source, options = {}) {
    const onProgress = options.onProgress || (() => {});
    wasmReady ??= init(options.wasmUrl);
    await wasmReady;
    onProgress({ status: 'init', message: 'opening weights' });
    const fetchFn = options.fetch || globalThis.fetch.bind(globalThis);
    const reader = await rangeReader(source, fetchFn, options.cache !== false);
    const t0 = performance.now();
    const engine = await Engine.load((off, len) => reader.read(off, len), reader.size(), options.maxLength ?? 32768,
      (done, total) => onProgress({ status: 'weights', kind: 'bytes', loaded: done, total, fraction: total ? done / total : null,
                                    message: `weights ${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB` }));
    onProgress({ status: 'ready', message: 'ready' });
    return new Lfm3ForCausalLM(engine, { load_ms: performance.now() - t0, file_bytes: reader.size() });
  }
  create_session() { return new ChatSession(this); }
  deviceInfo() { return { adapter: this.engine.adapter(), vram_bytes: this.engine.vram_bytes(), runtime: 'lfm3-lowbit', ...this.info }; }
  async dispose() { this.engine.free?.(); }
}
export default Lfm3ForCausalLM;
