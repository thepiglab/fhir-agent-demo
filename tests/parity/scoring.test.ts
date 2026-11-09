// Parity of the TypeScript scorer with scoring.evaluate_training on the golden corpus.
//
// Each episode's recorded fhir_requests are replayed through the TypeScript store and the
// final answer is scored with the options the corpus was generated with. The grading metrics
// must equal Python's exactly; every other metric is compared and reported, and expected to
// match too (the timing keys are dropped by the generator, their _observed forms are kept).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PyFloat } from '../../src/fhir/pyjson.ts';
import { evaluateTraining, EVIDENCE_TIMINGS } from '../../src/fhir/scoring.ts';
import type { ScoringStore } from '../../src/fhir/scoring.ts';
import { episodeStore, setEnvData } from '../../src/fhir/store.ts';
import { corpusInfo, episodes, missingData, shard, task } from './load.ts';
import type { Episode } from './load.ts';

const GRADING = [
  'workflow_success', 'strict_success', 'answer_success', 'state_success', 'evidence_recall',
  'evidence_precision', 'harmful_writes', 'mutation_integrity', 'safe_success', 'graded_reward', 'reward',
];

const ENV = new URL('../../public/data/env/', import.meta.url);
const skip = missingData();

beforeAll(() => {
  setEnvData({
    schema: JSON.parse(readFileSync(new URL('fhir.schema.json', ENV), 'utf8')),
    contracts: JSON.parse(readFileSync(new URL('resource_contracts.json', ENV), 'utf8')),
  });
});
const value = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v instanceof PyFloat ? v.value : v));

/** Rebuild the store the way the generator did and replay the episode's calls. */
function replay(episode: Episode): ScoringStore {
  const t = task(episode.cohort, episode.task_id);
  const store = episodeStore(t, shard(episode.cohort, t.shard), corpusInfo().max_calls, corpusInfo().options.interface);
  for (const call of episode.calls) {
    store.active_tool = 'fhir_request';
    store.agent_tools.push('fhir_request');
    store.round = call.turn;
    try {
      store.fhirRequestObject(call.args);
    } catch (error) {
      // The tool layer reports these as text; Python recorded the same call as 'raised'.
      if (call.raised === undefined) throw new Error(`${episode.id}: unexpected ${String(error)}`);
    }
  }
  return store as unknown as ScoringStore;
}

describe.skipIf(skip !== null)('scoring parity', () => {
  it('matches evaluate_training on every corpus episode', () => {
    const options = corpusInfo().options;
    const all = episodes();
    const failures: string[] = [];
    const other: Record<string, number> = {};
    const passed: Record<string, number> = {};
    const total: Record<string, number> = {};
    for (const episode of all) {
      total[episode.source] = (total[episode.source] ?? 0) + 1;
      const t = task(episode.cohort, episode.task_id);
      const got = evaluateTraining(t, replay(episode), episode.final, options);
      for (const name of EVIDENCE_TIMINGS) delete got[name];
      const bad: string[] = [];
      const keys = new Set([...Object.keys(episode.metrics), ...Object.keys(got)]);
      for (const key of keys) {
        const want = value(episode.metrics[key]);
        const have = key in got ? value(got[key]) : undefined;
        if (want === have) continue;
        const grading = GRADING.includes(key) || key.includes('absence');
        if (grading) bad.push(`${key}: python ${want} ts ${have}`);
        else other[key] = (other[key] ?? 0) + 1;
      }
      if (bad.length) failures.push(`${episode.id}: ${bad.join('; ')}`);
      else passed[episode.source] = (passed[episode.source] ?? 0) + 1;
    }
    console.log('scoring parity by source (passed/total):', Object.keys(total).map((s) => `${s} ${passed[s] ?? 0}/${total[s]}`).join(', '));
    console.log('non-grading keys that differ:', JSON.stringify(other));
    expect(failures.slice(0, 20)).toEqual([]);
    // Every other metric matches too (zero differences at the time of the port); keep it that way.
    expect(other).toEqual({});
  });
});

describe.skipIf(skip === null)('scoring parity (skipped)', () => {
  it.skip(skip ?? '', () => { expect(true).toBe(true); });
});
