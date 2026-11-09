// The reply turn (src/chart/reply.ts): the checks that gate the clinician's sentences, and the turn
// end to end through /api/ask with a scripted model (search, answer, then the tool-free reply).
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { checkReply, replyMessages } from '../src/chart/reply.ts';
import type { ReplyInput } from '../src/chart/reply.ts';

const HGB = 'Observation/b64801f28f3fc9544dd17fb0';  // 14.2 g/dL on 2023-03-08
const LOW = 'Observation/ab2ef9da7ff8fe69dd660909';  // 11.5 g/dL on 2023-02-10
const input: ReplyInput = {
  question: 'Latest hemoglobin, and is it lower than the one before?',
  answer: { value: 14.2, unit: 'g/dL', date: '2023-03-08' },
  evidence: [{ ref: HGB, json: '{"resourceType": "Observation", "id": "b64801f28f3fc9544dd17fb0", "effectiveDateTime": "2023-03-08", "valueQuantity": {"unit": "g/dL", "value": 14.2}}' }],
  writes: [],
};

describe('reply checks', () => {
  it('passes a short reply that cites the agent\'s record and restates its numbers', () => {
    const r = checkReply(`The latest hemoglobin was 14.2 g/dL on March 8, 2023 [${HGB}].`, input);
    expect(r).toMatchObject({ ok: true, problems: [], refs: [HGB] });
  });
  it('refuses a citation the agent did not make', () => {
    const r = checkReply(`Hemoglobin was 14.2 g/dL [${HGB}], up from before [${LOW}].`, input);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain(LOW);
  });
  it('refuses a number the cited records do not hold', () => {
    const r = checkReply(`The latest hemoglobin was 14.2 g/dL [${HGB}], up 1.3 from the last value.`, input);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('1.3');
  });
  it('refuses a reply without citations, or JSON', () => {
    expect(checkReply('The latest hemoglobin was 14.2 g/dL.', input).problems).toContain('cites no record');
    // An absence, with no numbers and nothing to cite, passes.
    expect(checkReply('The chart does not document a potassium in the past six weeks.', input).ok).toBe(true);
    const asked = { ...input, question: 'Any potassium in the past 6 weeks?' };
    expect(checkReply('No potassium results were found in the past 6 weeks.', asked).ok).toBe(true);
    expect(checkReply('Potassium was 14.2 in the past 6 weeks.', asked).problems).toContain('cites no record');
    expect(checkReply(`{"answer": 14.2} [${HGB}]`, input).problems).toContain('not plain sentences');
    expect(checkReply('', input).problems).toContain('empty');
  });
  it('builds the pilot\'s writer prompt', () => {
    const [system, user] = replyMessages(input);
    expect(system!.content).toMatch(/answer-writing step of an EHR search assistant/);
    expect(user!.content).toContain(`## Records the agent cited\n[${HGB}] {"resourceType"`);
    expect(user!.content).toContain('## Write log\n(no writes)');
    expect(user!.content).toContain('Write 1-4 sentences');
  });
});

// --- end to end -----------------------------------------------------------------------------------
interface Scripted { content?: string; calls?: { name: string; arguments: Record<string, unknown> }[] }
const queue: Scripted[] = [];
const seen: { messages: { role: string; content?: string }[]; tools: boolean }[] = [];
vi.mock('../src/chart/model-host.ts', () => ({
  modelName: 'scripted reply test',
  startModel: async () => ({
    create_session: () => ({
      generate: (messages: { role: string; content?: string }[], options: { tools?: unknown[] }) => {
        seen.push({ messages, tools: !!options.tools?.length });
        const next = queue.shift();
        if (!next) throw new Error('more model calls than scripted');
        const tool_calls = (next.calls ?? []).map((c, i) => ({ id: `c${i}`, type: 'function', function: c }));
        const message = { role: 'assistant', content: next.content ?? '', ...(tool_calls.length ? { tool_calls } : {}) };
        return {
          async *[Symbol.asyncIterator]() { /* no streamed events */ },
          cancel() {},
          result: Promise.resolve({ message, usage: { prompt_tokens: 100, completion_tokens: 20 }, finish_reason: tool_calls.length ? 'tool_calls' : 'stop' }),
        };
      },
      dispose: async () => {},
    }),
  }),
}));

const { handle } = await import('../src/chart/api.ts');
const { chooseCohort, setDataBase } = await import('../src/chart/data.ts');
const PUBLIC = new URL('../public/', import.meta.url);
const BASE = 'http://demo.test/';
const PATIENT = '4f97779f0e9245b5b4666efb';

async function ask(question: string, reply: string, asked = true): Promise<Record<string, unknown>[]> {
  queue.length = 0;
  seen.length = 0;
  queue.push(
    { calls: [{ name: 'fhir_request', arguments: { method: 'GET', path: `Observation?patient=${PATIENT}&code=718-7` } }] },
    { content: JSON.stringify({ answer: { value: 14.2, unit: 'g/dL', date: '2023-03-08' }, evidence: [HGB] }) },
    { content: reply },
  );
  const res = await handle('/api/ask', { method: 'POST', body: JSON.stringify({ patient: PATIENT, question, stream: true, harness: 'L', ...(asked ? { reply: true } : {}) }) });
  return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe.skipIf(!existsSync(new URL('data/cohorts.json', PUBLIC)))('reply turn through /api/ask', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const file = new URL(new URL(String(url), BASE).pathname.slice(1), PUBLIC);
      return existsSync(file) ? new Response(readFileSync(file)) : new Response('missing', { status: 404 });
    });
    setDataBase(BASE + 'data/');
    chooseCohort('natural-v0.2.3');
  });

  it('writes a checked reply after the answer, with no tools', async () => {
    const events = await ask('Latest hemoglobin?', `The latest hemoglobin was 14.2 g/dL on 2023-03-08 [${HGB}].`);
    const kinds = events.map((e) => e.event);
    expect(kinds.indexOf('done')).toBeLessThan(kinds.indexOf('reply'));  // the answer card comes first
    expect((events.find((e) => e.event === 'done') as { reply: string }).reply).toBe('pending');
    const { reply } = events.find((e) => e.event === 'reply') as { reply: { state: string; refs: string[] } };
    expect(reply).toMatchObject({ state: 'shown', refs: [HGB] });
    const writer = seen.at(-1)!;
    expect(writer.tools).toBe(false);
    expect(writer.messages[1]!.content).toContain(`[${HGB}] {`);
  });

  it('is off unless asked: no reply turn, no third model call', async () => {
    const events = await ask('Latest hemoglobin?', 'never written', false);
    expect(events.some((e) => e.event === 'reply' || e.event === 'reply_start')).toBe(false);
    expect((events.find((e) => e.event === 'done') as { reply: unknown }).reply).toBeNull();
    expect(seen.length).toBe(2);
  });

  it('withholds a reply that fails the checks; the answer stays', async () => {
    const events = await ask('Latest hemoglobin?', `It was 14.2 g/dL [${HGB}], down from 15.0 [${LOW}].`);
    const { reply } = events.find((e) => e.event === 'reply') as { reply: { state: string; problems: string[] } };
    expect(reply.state).toBe('refused');
    expect(reply.problems.length).toBe(2);
    expect((events.find((e) => e.event === 'done') as { trace: { final: unknown } }).trace.final).toBeTruthy();
  });
});

describe('reply write claims', () => {
  const ok = { method: 'POST', ref: 'Task/abcdef12', status: '201' };
  const refused = { method: 'PUT', ref: 'ServiceRequest/abcdef12', status: '403' };
  const withLog = (writes: ReplyInput['writes']): ReplyInput => ({ ...input, writes });

  it('blocks a claimed write with an empty log', () => {
    const r = checkReply('A note has been sent to the care team.', withLog([]));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('sent');
  });
  it('blocks a claim of a write the chart refused', () => {
    const r = checkReply('The referral was released.', withLog([refused]));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain('PUT -> 403');
    // A different kind of success does not cover it.
    expect(checkReply('The referral was released.', withLog([ok])).ok).toBe(false);
  });
  it('lets through a write the log shows succeeded, and chart facts that cite a record', () => {
    expect(checkReply('A task was created for the care team.', withLog([ok])).ok).toBe(true);
    expect(checkReply(`The referral was cancelled before then [${HGB}].`, withLog([])).ok).toBe(true);
    expect(checkReply('The chart does not document a potassium.', withLog([])).ok).toBe(true);
  });
});

describe('reply numbers', () => {
  it('compares numbers whole, with dates in parts', () => {
    expect(checkReply(`Hemoglobin was 14.2 on March 8, 2023 [${HGB}].`, input).ok).toBe(true);
    expect(checkReply(`Hemoglobin was 4.2 [${HGB}].`, input).ok).toBe(false);  // a substring of 14.2
    expect(checkReply(`Hemoglobin was 14.20 g/dL [${HGB}].`, input).ok).toBe(true);
  });
});
