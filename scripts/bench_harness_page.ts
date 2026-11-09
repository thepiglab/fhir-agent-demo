// In-browser timing of harness X16 against L (run in the dev server's page console).
//
// 1. Build the contexts: node scripts/bench_harness_contexts.ts ... --out models/harness-bench.json
//    (models/ is git-ignored; the dev server serves it).
// 2. Open http://localhost:5173/chart.html with the model loaded, then in the console:
//      const b = await import('/scripts/bench_harness_page.ts'); await b.run(); b.summary();
//
// Every recorded model call's exact context goes through the real WebGPU runtime in one session
// per question (so prefix reuse is the runtime's own): prefill is the measured time to first
// token; decode is the recorded completion length over the decode speed measured at that context
// (48 tokens generated). Upper bound: the recorded replies differ from what the model generates
// here, so each turn also re-prefills the previous reply (about decoded tokens / prefill rate).
import type { Rec } from '../src/fhir/pyrt.ts';

interface CallResult { prompt?: number; cached?: number; produced?: number; recorded: number; recorded_prompt: number; ttft?: number | null; tps?: number | null; error?: string; wall: number }
interface EpisodeResult { harness: string; task: string; family: string; recorded_tokens: number; calls: CallResult[] }

export const results: EpisodeResult[] = [];

export async function run(file = '/models/harness-bench.json'): Promise<EpisodeResult[]> {
  const host = await import('../src/chart/model-host.ts');
  const model = await host.startModel();
  if (!model) throw new Error('load the model first');
  const data = await (await fetch(file, { cache: 'no-store' })).json() as { tools: Record<string, unknown[]>; benches: { harness: string; task_id: string; family: string; total_tokens: number; calls: { messages: Rec[]; completion_tokens: number; prompt_tokens: number }[] }[] };
  results.length = 0;
  for (const b of data.benches) {
    const session = model.create_session();
    const res: EpisodeResult = { harness: b.harness, task: b.task_id, family: b.family, recorded_tokens: b.total_tokens, calls: [] };
    for (const c of b.calls) {
      const t0 = performance.now();
      try {
        const gen = session.generate(c.messages as never, { tools: data.tools[b.harness] as never, enable_thinking: true, max_new_tokens: Math.max(1, Math.min(c.completion_tokens, 48)), temperature: 0, top_k: 50, seed: 42 });
        for await (const _event of gen) { /* drain */ }
        const r = await gen.result;
        res.calls.push({ prompt: r.usage.prompt_tokens, cached: r.usage.cached_tokens ?? 0, produced: r.usage.completion_tokens, recorded: c.completion_tokens, recorded_prompt: c.prompt_tokens, ttft: r.timings?.ttft_ms ?? null, tps: r.timings?.tokens_per_second ?? null, wall: performance.now() - t0 });
      } catch (e) {
        res.calls.push({ error: String(e instanceof Error ? e.message : e), recorded: c.completion_tokens, recorded_prompt: c.prompt_tokens, wall: performance.now() - t0 });
      }
    }
    await session.dispose();
    results.push(res);
  }
  return results;
}

/** Seconds per question (prefill, decode, total), turns, and whether the runtime's prompt token
 * counts equal the eval's (vLLM), per episode and per harness. */
export function summary() {
  const rows = results.map((r) => {
    const ok = r.calls.filter((c) => !c.error);
    const speeds = ok.filter((c) => (c.produced ?? 0) >= 8 && c.tps).map((c) => c.tps!).sort((a, b) => a - b);
    const typical = speeds[Math.floor(speeds.length / 2)] ?? 130;
    let prefill = 0, decode = 0;
    for (const c of ok) {
      prefill += (c.ttft ?? 0) / 1000;
      decode += c.recorded / ((c.produced ?? 0) >= 8 && c.tps ? c.tps : typical);
    }
    return { harness: r.harness, family: r.family, turns: r.calls.length, errors: r.calls.filter((c) => c.error).map((c) => c.error), prefill_s: prefill, decode_s: decode, total_s: prefill + decode, tokenizer_match: `${ok.filter((c) => c.prompt === c.recorded_prompt).length}/${ok.length}` };
  });
  const per = (h: string) => {
    const x = rows.filter((r) => r.harness === h).sort((a, b) => a.total_s - b.total_s);
    const mean = (k: 'prefill_s' | 'decode_s' | 'total_s' | 'turns') => x.reduce((a, r) => a + r[k], 0) / x.length;
    return { harness: h, n: x.length, median_total_s: x.length ? (x[Math.floor((x.length - 1) / 2)]!.total_s + x[Math.ceil((x.length - 1) / 2)]!.total_s) / 2 : 0, mean_total_s: mean('total_s'), mean_prefill_s: mean('prefill_s'), mean_decode_s: mean('decode_s'), mean_turns: mean('turns') };
  };
  return { rows, X16: per('X16'), L: per('L') };
}
