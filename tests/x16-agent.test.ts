// The Chart assistant's agent loop (src/chart/api.ts) run in harness X16 end to end: a benchmark
// question goes through /api/ask with a scripted model that answers with the replies recorded in
// the X16 golden corpus (tests/parity/x16-corpus.jsonl.gz). Every message list the loop sends must
// equal, byte for byte, the one the Python X16 profile sent for the same replies, and the run must
// be graded as Python graded it. This covers what the profile test does not: the runtime adapter
// (tool-call arguments re-encoded as vLLM's JSON text, the model's own messages for its past turns),
// the exported benchmark data, and the grading path.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PyFloat, pyDumps, pyParse } from '../src/fhir/pyjson.ts';
import { loadsStrict } from '../src/fhir/protocol.ts';
import type { Rec } from '../src/fhir/pyrt.ts';

interface Reply { message: Rec; usage: { prompt_tokens: number; completion_tokens: number } }
interface Golden {
  id: string; variant: string; cohort: string; task_id: string; calls: { messages_sha: string; reply: Reply }[];
  metrics: Record<string, number | boolean | null>;
}

const queue: Reply[] = [];
/** Throw the runtime's context overflow on this model call (1-based); 0: never. */
const overflow = { at: 0, calls: 0 };
vi.mock('../src/chart/model-host.ts', () => ({
  modelName: 'scripted X16 replay',
  startModel: async () => ({
    create_session: () => ({
      generate: () => {
        overflow.calls += 1;
        if (overflow.at && overflow.calls === overflow.at) {
          const error = new Error('the conversation needs 17808 tokens (prompt plus one reply token) but the context holds 16384');
          error.name = 'ContextOverflowError';
          throw error;
        }
        const next = queue.shift();
        if (!next) throw new Error('more model calls than Python made');
        const m = next.message;
        const toolCalls = ((m.tool_calls as Rec[] | undefined) ?? []).map((c) => {
          const fn = c.function as Rec;
          return { id: c.id as string, type: 'function', function: { name: fn.name as string, arguments: loadsStrict(fn.arguments as string) } };
        });
        const message: Rec = { role: 'assistant', content: (m.content as string | undefined) ?? null };
        if (m.reasoning_content) message.reasoning_content = m.reasoning_content;
        if (toolCalls.length) message.tool_calls = toolCalls;
        return {
          async *[Symbol.asyncIterator]() { /* no streamed events */ },
          cancel() {},
          result: Promise.resolve({ message, usage: next.usage, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }),
        };
      },
      dispose: async () => {},
    }),
  }),
}));

const { handle, x16Probe } = await import('../src/chart/api.ts');
const { chooseCohort, setDataBase } = await import('../src/chart/data.ts');

const PUBLIC = new URL('../public/', import.meta.url);
const CORPUS = new URL('parity/x16-corpus.jsonl.gz', import.meta.url);
const BASE = 'http://demo.test/';
const ready = existsSync(new URL('data/cohorts.json', PUBLIC)) && existsSync(CORPUS);
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v instanceof PyFloat ? v.value : v));
const GRADING = ['workflow_success', 'strict_success', 'answer_success', 'state_success', 'evidence_recall', 'evidence_precision', 'harmful_writes', 'mutation_integrity'];

describe.skipIf(!ready)('Chart assistant in harness X16', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input), BASE);
      const file = new URL(url.pathname.slice(1), PUBLIC);
      return existsSync(file) ? new Response(readFileSync(file)) : new Response('missing', { status: 404 });
    });
    setDataBase(BASE + 'data/');
    // The recorded runs are on natural v0.2.2, now a developer-view cohort: turn that view on.
    const store = new Map<string, string>([['fhir-demo-dev', 'true']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    chooseCohort('natural-v0.2.2');
  });

  it.each([
    ['X16', CORPUS],
    ['X16v2', new URL('parity/x16v2-corpus.jsonl.gz', import.meta.url)],
  ])('sends Python %s contexts and grades like Python on recorded runs', async (harness, corpus) => {
    if (!existsSync(corpus)) return;
    const golden = gunzipSync(readFileSync(corpus)).toString('utf8').split('\n').filter(Boolean)
      .map((l) => pyParse<Golden>(l))
      // LFM3 episodes: the adapter re-encodes arguments as vLLM's LFM3 parser does (GPT-OSS's
      // harmony parser keeps the model's own JSON text, which no LFM3 runtime produces).
      .filter((e) => e.cohort === 'natural-v0.2.2' && e.id.startsWith('trace/lfm3') && (e.variant === 'plain' || e.variant === 'zero'));
    // The browser ships natural v0.2.2 dev (keyed persona left out): real SFT v0.6.1-X16 eval runs.
    const sample = golden;
    const index = JSON.parse(readFileSync(new URL('data/natural-v0.2.2/questions.json', PUBLIC), 'utf8')) as { id: string; patient: string }[];
    const patientOf = new Map(index.map((q) => [q.id, q.patient]));
    const failures: string[] = [];
    let checked = 0;
    for (const e of sample) {
      const patient = patientOf.get(e.task_id);
      if (!patient) continue;  // a keyed-persona task, not exported
      checked += 1;
      const tasks = (await (await handle('/api/benchmark', { method: 'POST', body: JSON.stringify({ patient }) })).json()) as { tasks: { id: string; prompt: string }[] };
      const task = tasks.tasks.find((t) => t.id === e.task_id);
      if (!task) { failures.push(`${e.id}: task not in the exported data`); continue; }
      queue.length = 0;
      queue.push(...e.calls.map((c) => c.reply));
      const sent: string[] = [];
      x16Probe.onContext = (messages) => sent.push(sha(pyDumps(messages)));
      const res = await handle('/api/ask', { method: 'POST', body: JSON.stringify({ patient, question: task.prompt, stream: true, harness }) });
      const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { event: string; trace?: Rec; error?: string });
      const done = lines.find((l) => l.event === 'done');
      if (!done?.trace) { failures.push(`${e.id}: ${lines.find((l) => l.event === 'error')?.error ?? 'no trace'}`); continue; }
      const bad: string[] = [];
      if (done.trace.harness !== harness) bad.push(`ran ${String(done.trace.harness)}`);
      if (sent.length !== e.calls.length) bad.push(`model calls ${sent.length} vs ${e.calls.length}`);
      const k = e.calls.findIndex((c, i) => sent[i] !== c.messages_sha);
      if (k >= 0) bad.push(`call ${k + 1}: context differs`);
      const metrics = ((done.trace.benchmark as Rec | undefined)?.metrics ?? {}) as Rec;
      for (const key of GRADING) if (num(metrics[key]) !== num(e.metrics[key])) bad.push(`${key}: python ${num(e.metrics[key])} browser ${num(metrics[key])}`);
      if (bad.length) failures.push(`${e.id}: ${bad.join('; ')}`);
    }
    x16Probe.onContext = undefined;
    if (failures.length) console.log(failures.slice(0, 10).join('\n'));
    expect(checked).toBeGreaterThan(40);
    expect(failures).toEqual([]);
  }, 300_000);

  it('ends a run that outgrows the context with a "too long" message', async () => {
    const golden = gunzipSync(readFileSync(CORPUS)).toString('utf8').split('\n').filter(Boolean)
      .map((l) => pyParse<Golden>(l)).filter((e) => e.cohort === 'natural-v0.2.2' && e.id.startsWith('trace/lfm3') && e.variant === 'plain' && e.calls.length >= 3);
    const index = JSON.parse(readFileSync(new URL('data/natural-v0.2.2/questions.json', PUBLIC), 'utf8')) as { id: string; patient: string }[];
    const inIndex = golden.filter((e) => index.some((q) => q.id === e.task_id));
    const chosen = inIndex[0]!;
    const patient = index.find((q) => q.id === chosen.task_id)!.patient;
    const tasks = (await (await handle('/api/benchmark', { method: 'POST', body: JSON.stringify({ patient }) })).json()) as { tasks: { id: string; prompt: string }[] };
    const task = tasks.tasks.find((t) => t.id === chosen.task_id)!;
    queue.length = 0;
    queue.push(...chosen.calls.map((c) => c.reply));
    Object.assign(overflow, { at: 2, calls: 0 });
    const res = await handle('/api/ask', { method: 'POST', body: JSON.stringify({ patient, question: task.prompt, stream: true, harness: 'X16' }) });
    const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { event: string; trace?: Rec });
    Object.assign(overflow, { at: 0, calls: 0 });  // after reading: the stream runs as it is read
    const done = lines.find((l) => l.event === 'done');
    expect(done?.trace?.stop_reason).toBe('too_long');
    expect(String(done?.trace?.error)).toMatch(/needed more than the 16,384 tokens of context .* Long charts/);
    expect(done?.trace?.final).toBeNull();
    expect((done?.trace?.benchmark as Rec | undefined)?.metrics).toBeTruthy();  // still graded (as a failure)
  }, 120_000);
});
