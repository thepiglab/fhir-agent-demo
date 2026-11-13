// The Chart assistant's agent loop (src/chart/api.ts) in harness Lc (?harness=Lc), end to end with a
// scripted model: the same three replies (a search, a read by id, an answer) run in L and in Lc. Lc
// must send L's conversation with exactly two changes: the system prompt gains lc_system_prompt's
// section, and the search result is render_compact_v2 of L's JSON text (byte parity of those two
// functions with the Python is tests/parity/lc.test.ts). The read stays L's JSON, and the run's
// exposure is deferred: a search exposes only what its rows showed in full.
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { lcSystemPrompt, renderCompactV2 } from '../src/fhir/compact_v2.ts';
import { pyParse } from '../src/fhir/pyjson.ts';
import type { Rec } from '../src/fhir/pyrt.ts';

type Call = { name: string; arguments: Rec };
const script: (Call[] | string)[] = [];
const seen: Rec[][] = [];
vi.mock('../src/chart/model-host.ts', () => ({
  modelName: 'scripted Lc run',
  startModel: async () => ({
    create_session: () => ({
      generate: (messages: Rec[]) => {
        seen.push(structuredClone(messages));
        const next = script.shift();
        if (next === undefined) throw new Error('no scripted reply left');
        const calls = typeof next === 'string' ? [] : next.map((c, i) => ({ id: `call_${seen.length}_${i}`, type: 'function', function: c }));
        const message: Rec = { role: 'assistant', content: typeof next === 'string' ? next : '' };
        if (calls.length) message.tool_calls = calls;
        return {
          async *[Symbol.asyncIterator]() { /* no streamed events */ },
          cancel() {},
          result: Promise.resolve({ message, usage: { prompt_tokens: 1, completion_tokens: 1 }, finish_reason: calls.length ? 'tool_calls' : 'stop' }),
        };
      },
      dispose: async () => {},
    }),
  }),
}));

const { handle } = await import('../src/chart/api.ts');
const { setDataBase, chooseCohort } = await import('../src/chart/data.ts');
const PUBLIC = new URL('../public/', import.meta.url);
const FIXTURES = new URL('fixtures/', import.meta.url);
const dataFile = (path: string): URL => {
  const fixture = new URL(path, FIXTURES);
  return existsSync(fixture) ? fixture : new URL(path, PUBLIC);
};
const BASE = 'http://demo.test/';
const ready = existsSync(new URL('data/cohorts.json', PUBLIC));

async function run(harness: string, patient: string, question: string, calls: Call[][]): Promise<{ messages: Rec[]; trace: Rec }> {
  script.length = 0;
  seen.length = 0;
  script.push(...calls, '{"answer": {}, "evidence": []}');
  const res = await handle('/api/ask', { method: 'POST', body: JSON.stringify({ patient, question, stream: true, harness }) });
  const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { event: string; trace?: Rec; error?: string });
  const done = lines.find((l) => l.event === 'done');
  if (!done?.trace) throw new Error(lines.find((l) => l.event === 'error')?.error ?? 'no trace');
  return { messages: seen.at(-1)!, trace: done.trace };
}

describe('?harness=Lc', () => {
  it('selects Lc from the page URL', async () => {
    const { activeHarness, MODEL_HARNESS } = await import('../src/model/config.ts');
    vi.stubGlobal('location', new URL(BASE + 'chart.html?harness=Lc'));
    expect(activeHarness()).toBe('Lc');
    vi.stubGlobal('location', new URL(BASE + 'chart.html?harness=X16'));
    expect(activeHarness()).toBe('X16');
    // An unknown value (the match is case-sensitive) falls back to the model's own harness.
    vi.stubGlobal('location', new URL(BASE + 'chart.html?harness=lc'));
    expect(activeHarness()).toBe(MODEL_HARNESS);
    vi.unstubAllGlobals();
  });
});

describe.skipIf(!ready)('Chart assistant in harness Lc', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const file = dataFile(new URL(String(input), BASE).pathname.slice(1));
      return existsSync(file) ? new Response(readFileSync(file)) : new Response('missing', { status: 404 });
    });
    setDataBase(BASE + 'data/');
    chooseCohort('natural-v0.2.3-heldout');
  });

  it('sends L with the Lc system section and compact searches only', async () => {
    const questions = JSON.parse(readFileSync(dataFile('data/natural-v0.2.3-heldout/questions.json'), 'utf8')) as { id: string; patient: string }[];
    const patient = questions[0]!.patient;
    const tasks = (await (await handle('/api/benchmark', { method: 'POST', body: JSON.stringify({ patient }) })).json()) as { tasks: { prompt: string }[] };
    const question = tasks.tasks[0]!.prompt;
    const calls: Call[][] = [
      [{ name: 'fhir_request', arguments: { method: 'GET', path: `Observation?patient=Patient/${patient}&_count=3` } }],
      [{ name: 'fhir_request', arguments: { method: 'GET', path: `Patient/${patient}` } }],
      [{ name: 'fhir_request', arguments: { method: 'GET', path: `Condition?patient=Patient/${patient}&code=no-such-code` } }],
    ];
    const L = await run('L', patient, question, calls);
    const Lc = await run('Lc', patient, question, calls);
    expect(L.trace.harness).toBe('L');
    expect(Lc.trace.harness).toBe('Lc');
    expect(Lc.messages.length).toBe(L.messages.length);
    expect(Lc.messages[0]!.content).toBe(lcSystemPrompt(L.messages[0]!.content as string));
    expect(Lc.messages[0]!.content).toMatch(/\n\nHarness behavior:\n- Compact search results: /);
    const tools = (m: Rec[]) => m.filter((x) => x.role === 'tool').map((x) => x.content as string);
    const [search, read, empty] = tools(L.messages);
    const [searchLc, readLc, emptyLc] = tools(Lc.messages);
    expect(searchLc).toBe(renderCompactV2(pyParse<Rec>(search!)).text);
    expect(searchLc).toMatch(/^HTTP 200\nBundle searchset total=\d+, 3 entries in this page\nnext: /);
    expect(emptyLc).toBe('HTTP 200\nBundle searchset total=0, 0 entries in this page');
    expect(emptyLc).toBe(renderCompactV2(pyParse<Rec>(empty!)).text);
    expect(readLc).toBe(read);  // a read by id stays L's JSON
    expect(Lc.messages.filter((x) => x.role !== 'tool' && x.role !== 'system')).toEqual(L.messages.filter((x) => x.role !== 'tool' && x.role !== 'system'));
    // The trace shows what the model saw, and describes the call from the result's JSON.
    const steps = (t: Rec) => (t.steps as Rec[]).filter((s) => s.type === 'tool');
    expect(steps(Lc.trace)[0]!.content).toBe(searchLc!.slice(0, 4000));
    expect(steps(Lc.trace).map((s) => [s.status, s.refs])).toEqual(steps(L.trace).map((s) => [s.status, s.refs]));
  });
});
