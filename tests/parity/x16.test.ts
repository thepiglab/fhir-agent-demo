// Parity of harness X16 (src/fhir/context1.ts) with the Python profile it ports.
//
// x16-corpus.jsonl.gz is written by the fhir-env repo's scripts/web_demo/make_x16_corpus.py: the
// Python X16 profile (fhir_suite_harness at the commit in x16-corpus-info.json) driven by recorded
// eval replies, in four variants (as recorded, with prunes and bad calls, a tight budget with the
// overflow pass and the turn cap, zero usage). Each episode is replayed here with the same replies
// and must give the same message list at every model call (byte for byte), the same harness
// metrics and budget events, the same final chart, the same exposure, and the same grading.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { Context1Profile, Episode as X16Episode } from '../../src/fhir/context1.ts';
import type { ModelReply } from '../../src/fhir/context1.ts';
import { PyFloat, pyDumps, pyParse } from '../../src/fhir/pyjson.ts';
import { evaluateTraining, EVIDENCE_TIMINGS } from '../../src/fhir/scoring.ts';
import type { ScoringStore } from '../../src/fhir/scoring.ts';
import { episodeStore, setEnvData } from '../../src/fhir/store.ts';
import type { Rec } from '../../src/fhir/pyrt.ts';
import { corpusInfo, missingData, shard, task } from './load.ts';

const HERE = new URL('./', import.meta.url);
const ENV = new URL('../../public/data/env/', import.meta.url);
const CONFIG = JSON.parse(readFileSync(new URL('../../public/data/config.json', import.meta.url), 'utf8')) as { system_prompt: string; tools: unknown[] };
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const GRADING = ['workflow_success', 'strict_success', 'answer_success', 'state_success', 'evidence_recall',
  'evidence_precision', 'harmful_writes', 'mutation_integrity', 'safe_success', 'graded_reward', 'reward'];

interface X16Call { messages_sha: string; tools_sha: string; messages: number; chars: number; reply: { message: Rec; usage: { prompt_tokens: number; completion_tokens: number } } }
interface X16Episode_ {
  id: string; variant: string; cohort: string; task_id: string; options: Record<string, number>; max_root_turns: number;
  calls: X16Call[]; last_messages: string; final: string; harness_metrics: Record<string, number>; budget_events: Rec[];
  state: { sha: string; resources: number; audit: number; events: number }; exposed_sha: string; event_exposure_sha: string;
  metrics: Record<string, number | boolean | null>;
  /** For real X16 eval runs: the budget events [tokens, next_turn] the eval logged. */
  recorded_budget?: [number, number][] | null;
}

const file = new URL('x16-corpus.jsonl.gz', HERE);
const skip = missingData() ?? (existsSync(file) ? null : 'no x16-corpus.jsonl.gz');
const corpus = (): X16Episode_[] => gunzipSync(readFileSync(file)).toString('utf8').split('\n').filter(Boolean).map((l) => pyParse<X16Episode_>(l));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v instanceof PyFloat ? v.value : v));

const sortedKeys = (o: Record<string, unknown>) => Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object' && !(v instanceof PyFloat)) {
    const out: Rec = {};
    for (const k of sortedKeys(v as Rec)) out[k] = canonical((v as Rec)[k]);
    return out;
  }
  return v;
}

beforeAll(() => {
  setEnvData({
    schema: JSON.parse(readFileSync(new URL('fhir.schema.json', ENV), 'utf8')),
    contracts: JSON.parse(readFileSync(new URL('resource_contracts.json', ENV), 'utf8')),
  });
});

async function replay(e: X16Episode_) {
  const t = task(e.cohort, e.task_id);
  const store = episodeStore(t as never, shard(e.cohort, t.shard) as never, 40, corpusInfo().options.interface);
  const sent: { sha: string; tools: string; text: string }[] = [];
  let i = 0;
  const chat = async (messages: Rec[], tools: unknown[]): Promise<ModelReply> => {
    const text = pyDumps(messages);
    sent.push({ sha: sha(text), tools: sha(pyDumps(tools)), text });
    const r = e.calls[i++]?.reply;
    if (!r) throw new Error('more model calls than Python made');
    const calls = ((r.message.tool_calls as Rec[] | undefined) ?? []).map((c) => {
      const fn = c.function as Rec;
      return { id: c.id as string, name: fn.name as string, arguments: fn.arguments as string };
    });
    return { content: (r.message.content as string | undefined) ?? '', tool_calls: calls, message: r.message, usage: r.usage, finish_reason: calls.length ? 'tool_calls' : 'stop' };
  };
  const ep = new X16Episode(store, chat, { max_root_turns: e.max_root_turns, deferred_exposure: true });
  const profile = new Context1Profile(CONFIG.tools[0], e.options);
  const final = (await profile.run(ep, CONFIG.system_prompt, t.prompt as string)).trim();
  return { store, ep, sent, final };
}

describe.skipIf(skip !== null)('harness X16 parity', () => {
  it('matches the Python profile on every corpus episode', async () => {
    const options = corpusInfo().options;
    const failures: string[] = [];
    const counts: Record<string, number> = {};
    let firstDiff = '';
    let recorded = 0;
    for (const e of corpus()) {
      counts[e.variant] = (counts[e.variant] ?? 0) + 1;
      const { store, ep, sent, final } = await replay(e);
      const bad: string[] = [];
      if (sent.length !== e.calls.length) bad.push(`model calls ${sent.length} vs ${e.calls.length}`);
      for (let k = 0; k < Math.min(sent.length, e.calls.length); k++) {
        if (sent[k]!.tools !== e.calls[k]!.tools_sha) { bad.push(`call ${k + 1}: tools differ`); break; }
        if (sent[k]!.sha !== e.calls[k]!.messages_sha) {
          bad.push(`call ${k + 1}: messages differ`);
          if (!firstDiff && k === e.calls.length - 1) {
            const a = e.last_messages, b = sent[k]!.text;
            let at = 0;
            while (at < a.length && a[at] === b[at]) at++;
            firstDiff = `${e.id} call ${k + 1} at char ${at}:\n  python ${JSON.stringify(a.slice(Math.max(0, at - 120), at + 200))}\n  ts     ${JSON.stringify(b.slice(Math.max(0, at - 120), at + 200))}`;
          }
          break;
        }
      }
      if (final !== e.final) bad.push('final text differs');
      const metrics = Object.fromEntries([...ep.metrics.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
      if (pyDumps(metrics) !== pyDumps(e.harness_metrics)) bad.push(`harness metrics ${pyDumps(metrics)} vs ${pyDumps(e.harness_metrics)}`);
      const events = ep.events.filter((x) => ['budget', 'overflow', 'hard_cutoff', 'prune'].includes(x.kind as string));
      if (pyDumps(events) !== pyDumps(e.budget_events)) bad.push('budget events differ');
      if (e.recorded_budget) {
        recorded += 1;
        const ours = events.filter((x) => x.kind === 'budget').map((x) => [x.tokens, x.next_turn]);
        if (pyDumps(ours) !== pyDumps(e.recorded_budget)) bad.push(`budget line differs from the real X16 eval: ${pyDumps(ours.slice(0, 5))} vs ${pyDumps(e.recorded_budget.slice(0, 5))}`);
      }
      const stateSha = sha(pyDumps([...store.resources.entries()]));
      if (stateSha !== e.state.sha) bad.push('final chart differs');
      const exposed: Rec = {};
      for (const k of [...store.exposed.keys()].sort()) exposed[k] = [...store.exposed.get(k)!].sort();
      if (sha(pyDumps(exposed)) !== e.exposed_sha) bad.push('store exposure differs');
      const eventExposure = store.events.map((x) => (x as unknown as Rec).exposed_fields ?? null);
      if (sha(pyDumps(canonical(eventExposure))) !== e.event_exposure_sha) bad.push('event exposure differs');
      const got = evaluateTraining(task(e.cohort, e.task_id), store as unknown as ScoringStore, e.final, options);
      for (const name of EVIDENCE_TIMINGS) delete got[name];
      for (const key of GRADING) if (num(e.metrics[key]) !== num(got[key])) bad.push(`${key}: python ${num(e.metrics[key])} ts ${num(got[key])}`);
      if (bad.length) failures.push(`${e.id}: ${bad.join('; ')}`);
    }
    if (failures.length) console.log(`${failures.length} episodes differ, e.g.\n${failures.slice(0, 12).join('\n')}\n${firstDiff}`);
    console.log('X16 corpus episodes by variant:', counts);
    expect(recorded).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  }, 600_000);
});
