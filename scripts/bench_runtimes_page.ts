// Our vendored WebGPU runtime against wllama (llama.cpp + ggml-webgpu, WASM), on one GGUF and the
// recorded L contexts of models/harness-bench.json (scripts/bench_harness_contexts.ts).
//
//   /scripts/bench-runtimes.html?rt=ours|wllama&model=/models/<file>.gguf
//
// wllama is the npm package as published, unpacked into the git-ignored models/ folder
// (models/wllama-<version>/ = the package's esm/ folder); nothing of it is a dependency of the demo.
//
// The page loads the model (timed) and sets window.__load. window.__run() then replays every call
// of every L episode in one session per episode (prefix reuse is each runtime's own), greedy, thinking
// on, GEN tokens per call: prefill = time to first token over the prompt tokens not cached; decode =
// tokens per second over the generated tokens. The generated text is kept, to compare the runtimes'
// greedy continuations token for token. Episode time = the sum over its calls of time to first token
// plus the recorded completion length at the measured decode speed (as bench_harness_page.ts).
import type { Rec } from '../src/fhir/pyrt.ts';

const params = new URLSearchParams(location.search);
const RT = params.get('rt') === 'wllama' ? 'wllama' : 'ours';
const MODEL_URL = new URL(params.get('model') || '/models/LFM3-FHIR-demo-v1-Q4_K_M.gguf', location.href).href;
const CONTEXTS = params.get('contexts') || '/models/harness-bench.json';
const WLLAMA = params.get('wllama') || '/models/wllama-3.13.0';
const CTX = Number(params.get('ctx') || 16384);
const GEN = Number(params.get('gen') || 64);
const log = (s: string) => { document.getElementById('log')!.textContent += '\n' + s; };

interface CallOut { prompt: number; cached: number; produced: number; recorded: number; ttftMs: number; tps: number; text: string; error?: string }
interface EpisodeOut { family: string; task: string; calls: CallOut[]; episodeSeconds: number }

/** One runtime behind one interface: start an episode, then generate per call. */
interface Runner {
  episode(): Promise<{ call(messages: Rec[], tools: unknown[], recorded: number): Promise<CallOut>; close(): Promise<void> }>;
}

async function ours(): Promise<Runner> {
  const { load } = await import('../src/model/model.ts');
  const model = await load({ url: MODEL_URL });
  return {
    async episode() {
      const session = model.create_session();
      return {
        async call(messages, tools, recorded) {
          let text = '';
          const gen = session.generate(messages as never, { tools: tools as never, enable_thinking: true, max_new_tokens: GEN, temperature: 0, top_k: 50, seed: 42 });
          for await (const e of gen) if (e.type === 'reasoning' || e.type === 'text') text += e.text; else if (e.type === 'tool_call') text += JSON.stringify(e.tool_call);
          const r = await gen.result;
          return {
            prompt: r.usage.prompt_tokens, cached: r.usage.cached_tokens ?? 0, produced: r.usage.completion_tokens, recorded,
            ttftMs: r.timings?.ttft_ms ?? NaN, tps: r.timings?.tokens_per_second ?? NaN, text,
          };
        },
        close: () => session.dispose(),
      };
    },
  };
}

/** OpenAI-style messages: tool-call arguments as JSON strings. */
function oai(messages: Rec[]): Rec[] {
  return messages.map((m) => {
    const calls = m.tool_calls as Rec[] | undefined;
    if (!Array.isArray(calls)) return m;
    return {
      ...m,
      tool_calls: calls.map((c) => {
        const fn = c.function as Rec;
        return { ...c, function: { ...fn, arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments) } };
      }),
    };
  });
}

async function wllama(): Promise<Runner> {
  const mod = await import(/* @vite-ignore */ `${WLLAMA}/index.js`) as { Wllama: new (paths: Record<string, string>, cfg?: Record<string, unknown>) => Rec };
  const w = new mod.Wllama({ default: `${WLLAMA}/wasm/wllama.wasm` }, { suppressNativeLog: true }) as Record<string, (...a: unknown[]) => Promise<unknown>>;
  await w.loadModelFromUrl!(MODEL_URL, { n_ctx: CTX, n_gpu_layers: 999, jinja: true, useCache: true });
  return {
    async episode() {
      return {
        async call(messages, tools, recorded) {
          const t0 = performance.now();
          let first = 0, text = '';
          const res = await w.createChatCompletion!({
            messages: oai(messages), tools, max_tokens: GEN, temperature: 0, temp: 0, top_k: 50, seed: 42,
            chat_template_kwargs: { enable_thinking: true }, cache_prompt: true, stream: true,
            onData: (chunk: Rec) => {
              const delta = ((chunk.choices as Rec[] | undefined)?.[0]?.delta ?? {}) as Rec;
              const piece = String(delta.reasoning_content ?? '') + String(delta.content ?? '') + (delta.tool_calls ? JSON.stringify(delta.tool_calls) : '');
              if (piece && !first) first = performance.now();
              text += piece;
              if (chunk.timings) last = chunk.timings as Rec;
              if (chunk.usage) usage = chunk.usage as Rec;
            },
          });
          void res;
          const t = last ?? {};
          return {
            prompt: Number(usage?.prompt_tokens ?? Number(t.prompt_n ?? 0) + Number(t.cache_n ?? 0)), cached: Number(t.cache_n ?? 0),
            produced: Number(t.predicted_n ?? usage?.completion_tokens ?? 0), recorded,
            // llama.cpp's own timings: prompt_ms is prefill; predicted_per_second is decode.
            ttftMs: Number(t.prompt_ms ?? (first ? first - t0 : NaN)), tps: Number(t.predicted_per_second ?? NaN), text,
          };
        },
        close: async () => { await w.kvClear?.().catch?.(() => {}); },
      };
    },
  };
}
let last: Rec | null = null;
let usage: Rec | null = null;

const t0 = performance.now();
let runner: Runner | null = null;
const w = window as unknown as Record<string, unknown>;
try {
  runner = RT === 'wllama' ? await wllama() : await ours();
  w.__load = { rt: RT, ms: Math.round(performance.now() - t0), crossOriginIsolated: self.crossOriginIsolated };
  log(`loaded ${RT} in ${Math.round(performance.now() - t0)} ms`);
} catch (e) {
  w.__load = { rt: RT, error: String(e instanceof Error ? e.stack ?? e.message : e) };
  log('load failed: ' + String(e));
}

w.__run = async (): Promise<EpisodeOut[]> => {
  if (!runner) throw new Error('not loaded');
  const data = await (await fetch(CONTEXTS, { cache: 'no-store' })).json() as {
    tools: Record<string, unknown[]>; benches: { harness: string; task_id: string; family: string; calls: { messages: Rec[]; completion_tokens: number }[] }[];
  };
  const out: EpisodeOut[] = [];
  for (const b of data.benches.filter((x) => x.harness === 'L')) {
    const ep = await runner.episode();
    const calls: CallOut[] = [];
    for (const c of b.calls) {
      last = null; usage = null;
      try { calls.push(await ep.call(c.messages, data.tools.L!, c.completion_tokens)); }
      catch (e) { calls.push({ prompt: 0, cached: 0, produced: 0, recorded: c.completion_tokens, ttftMs: NaN, tps: NaN, text: '', error: String(e) }); }
    }
    await ep.close();
    const episodeSeconds = calls.reduce((s, c) => s + (c.ttftMs + (c.recorded / c.tps) * 1000) / 1000, 0);
    out.push({ family: b.family, task: b.task_id, calls, episodeSeconds });
    log(`${b.family}: ${calls.length} calls, ${episodeSeconds.toFixed(1)} s`);
  }
  return out;
};
