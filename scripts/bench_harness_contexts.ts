// Contexts for the in-browser harness timing benchmark (scripts/bench_harness_page.ts).
//
// For each sampled recorded eval run, the exact message list of every model call, in the
// runtime's ChatMessage format, with the recorded completion length:
//  - L runs: the recorded nodes are the context (the locked harness only appends);
//  - X16 runs: the context is rebuilt by the TypeScript port (src/fhir/context1.ts, byte for byte
//    with the eval, see tests/parity/x16.test.ts) from the run's recorded replies and the task's
//    chart (the data roots in tests/parity/roots.local.json).
// Episodes are sampled across the distribution of total tokens (every n-th by size).
//
//   node scripts/bench_harness_contexts.ts --x16 a.traces.jsonl@natural-v0.2.2 \
//        --l lfm3-sft-v0.4.traces.jsonl --n 10 --out models/harness-bench.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Context1Profile, Episode } from '../src/fhir/context1.ts';
import type { ModelReply } from '../src/fhir/context1.ts';
import { episodeStore, setEnvData } from '../src/fhir/store.ts';
import { pyParse } from '../src/fhir/pyjson.ts';
import type { Rec } from '../src/fhir/pyrt.ts';

const arg = (name: string, fallback = ''): string => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1]! : fallback; };
const N = Number(arg('--n', '10'));
const roots = JSON.parse(readFileSync(new URL('../tests/parity/roots.local.json', import.meta.url), 'utf8')) as Record<string, string>;
const config = JSON.parse(readFileSync(new URL('../public/data/config.json', import.meta.url), 'utf8')) as { system_prompt: string; tools: Rec[] };
const env = new URL('../public/data/env/', import.meta.url);
setEnvData({ schema: JSON.parse(readFileSync(new URL('fhir.schema.json', env), 'utf8')), contracts: JSON.parse(readFileSync(new URL('resource_contracts.json', env), 'utf8')) });

interface Call { messages: Rec[]; completion_tokens: number; prompt_tokens: number }
interface Bench { harness: 'L' | 'X16'; task_id: string; family: string; total_tokens: number; calls: Call[] }

function readTraces(path: string): Rec[] {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { traces: Rec[] }).traces[0]!);
}
const usage = (t: Rec) => ((t.calls as Rec[]) ?? []).map((c) => (c.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number });
const total = (t: Rec) => usage(t).reduce((a, u) => a + (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0), 0);
/** Every n-th run by total tokens, so the sample spans the distribution. */
function spread(traces: Rec[], n: number): Rec[] {
  const sorted = [...traces].sort((a, b) => total(a) - total(b));
  return Array.from({ length: n }, (_, i) => sorted[Math.floor((i + 0.5) * sorted.length / n)]!);
}
/** A recorded (verifiers) message in the runtime's ChatMessage format. */
function runtimeMessage(m: Rec): Rec {
  if (m.role !== 'assistant') return m.role === 'tool' ? { role: 'tool', tool_call_id: m.tool_call_id, content: m.content } : { role: m.role, content: m.content };
  const out: Rec = { role: 'assistant', content: (m.content as string | undefined) ?? '' };  // the runtime's own messages carry ''
  if (m.reasoning_content) out.reasoning_content = m.reasoning_content;
  const calls = (m.tool_calls as Rec[] | undefined) ?? [];
  if (calls.length) out.tool_calls = calls.map((c) => {
    const fn = (c.function as Rec | undefined) ?? c;
    let args: unknown = {};
    try { args = JSON.parse(String(fn.arguments ?? '{}')); } catch { args = {}; }
    return { id: c.id, type: 'function', function: { name: fn.name, arguments: args } };
  });
  return out;
}

function lBench(t: Rec): Bench {
  const nodes = (t.nodes as Rec[]).map((n) => n.message as Rec);
  const calls: Call[] = [];
  let k = 0;
  const u = usage(t);
  nodes.forEach((m, i) => {
    if (m.role !== 'assistant') return;
    calls.push({ messages: nodes.slice(0, i).map(runtimeMessage), completion_tokens: u[k]?.completion_tokens ?? 0, prompt_tokens: u[k]?.prompt_tokens ?? 0 });
    k += 1;
  });
  const info = t.info as Rec;
  return { harness: 'L', task_id: String(info.task_id), family: String(info.family), total_tokens: total(t), calls };
}

async function x16Bench(t: Rec, cohort: string): Promise<Bench> {
  const info = t.info as Rec;
  const tasks = new Map(readFileSync(`${roots[cohort]}/dev/tasks.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => { const r = pyParse<Rec>(l); return [r.id as string, r]; }));
  const task = tasks.get(String(info.task_id))!;
  const shardPath = `${roots[cohort]}/${task.shard as string}`;
  const shard = readFileSync(shardPath, 'utf8').split('\n').filter(Boolean).map((l) => pyParse<Rec>(l));
  const store = episodeStore(task as never, shard as never, 40, 'v0.5');
  const nodes = t.nodes as Rec[];
  const replies = (t.calls as Rec[]).map((c) => ({ m: (nodes[c.node as number]!.message) as Rec, u: (c.usage ?? {}) as { prompt_tokens: number; completion_tokens: number } }));
  const runtimeOf = new WeakMap<Rec, Rec>();
  const calls: Call[] = [];
  let i = 0;
  const chat = async (messages: Rec[]): Promise<ModelReply> => {
    const r = replies[i++]!;
    calls.push({ messages: messages.map((m) => runtimeOf.get(m) ?? m), completion_tokens: r.u.completion_tokens ?? 0, prompt_tokens: r.u.prompt_tokens ?? 0 });
    const toolCalls = ((r.m.tool_calls as Rec[] | undefined) ?? []).map((c) => ({ id: c.id as string, name: c.name as string, arguments: String(c.arguments ?? '') }));
    const message: Rec = {};
    if (r.m.content != null) message.content = r.m.content;
    message.role = 'assistant';
    if (toolCalls.length) message.tool_calls = toolCalls.map((c) => ({ id: c.id, function: { arguments: c.arguments, name: c.name }, type: 'function' }));
    if (r.m.reasoning_content) message.reasoning_content = r.m.reasoning_content;
    runtimeOf.set(message, runtimeMessage(r.m));
    return { content: (r.m.content as string | undefined) ?? '', tool_calls: toolCalls, message, usage: r.u, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' };
  };
  const ep = new Episode(store, chat, { max_root_turns: 20, deferred_exposure: true });
  await new Context1Profile(config.tools[0]).run(ep, config.system_prompt, task.prompt as string);
  return { harness: 'X16', task_id: String(info.task_id), family: String(info.family), total_tokens: total(t), calls };
}

const benches: Bench[] = [];
const x16 = arg('--x16');
if (x16) {
  const [path, cohort] = x16.split('@');
  // Complete runs only: every call names its reply node.
  const complete = readTraces(path!).filter((t) => (t.calls as Rec[]).every((c) => typeof c.node === 'number' && (t.nodes as Rec[])[c.node as number]));
  for (const t of spread(complete, N)) benches.push(await x16Bench(t, cohort!));
}
const l = arg('--l');
if (l && existsSync(l)) for (const t of spread(readTraces(l), N)) benches.push(lBench(t));
const out = arg('--out', 'models/harness-bench.json');
writeFileSync(out, JSON.stringify({ tools: { L: config.tools, X16: [config.tools[0], (await import('../src/fhir/context1.ts')).PRUNE_TOOL] }, benches }));
for (const b of benches) console.log(b.harness, b.task_id.slice(0, 12), b.family, 'calls', b.calls.length, 'recorded tokens', b.total_tokens);
