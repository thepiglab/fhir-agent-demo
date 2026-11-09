// Parity of the TypeScript FHIR store with the canonical Python (fhir_query_rl.store) on the
// golden corpus: every recorded fhir_request is replayed through episodeStore and must produce
// the exact response text, and the chart state afterwards must match Python's.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { pyDumps } from '../../src/fhir/pyjson.ts';
import { setEnvData } from '../../src/fhir/store.ts';
import { episodeStore } from '../../src/fhir/store.ts';
import { corpusInfo, episodes, missingData, sha256, shard, task } from './load.ts';
import type { Episode } from './load.ts';

const ENV = new URL('../../public/data/env/', import.meta.url);
const skip = missingData();

beforeAll(() => {
  setEnvData({
    schema: JSON.parse(readFileSync(new URL('fhir.schema.json', ENV), 'utf8')),
    contracts: JSON.parse(readFileSync(new URL('resource_contracts.json', ENV), 'utf8')),
  });
});

/** The first place two responses differ, with context. */
function diff(expected: string, actual: string): string {
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  const window = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 120));
  return `first difference at char ${i} (python ${expected.length} chars, ts ${actual.length})\n  python: ${window(expected)}\n  ts:     ${window(actual)}`;
}

/** Replay one episode; returns the problems found (empty when it matches). */
function check(episode: Episode): string[] {
  const t = task(episode.cohort, episode.task_id);
  const info = corpusInfo();
  const store = episodeStore(t, shard(episode.cohort, t.shard), info.max_calls, info.options.interface);
  const problems: string[] = [];
  episode.calls.forEach((call, n) => {
    store.active_tool = 'fhir_request';
    store.agent_tools.push('fhir_request');
    store.round = call.turn;
    let output: string | null = null;
    let thrown: unknown = null;
    try {
      output = store.fhirRequestObject(call.args);
    } catch (error) {
      thrown = error;
    }
    const where = `${episode.id} call ${n + 1} ${call.args.method} ${call.args.path}`;
    if (call.raised !== undefined) {
      if (thrown === null) problems.push(`${where}: Python raised ${call.raised}, TS returned a response`);
      else if (!call.raised.startsWith((thrown as { kind?: string }).kind ?? '\0')) {
        problems.push(`${where}: Python raised ${call.raised}, TS threw ${String(thrown)}`);
      }
      return;
    }
    if (thrown !== null) {
      problems.push(`${where}: TS threw ${String(thrown)}`);
    } else if (sha256(output!) !== call.sha || (call.output !== undefined && output !== call.output)) {
      problems.push(`${where}: response differs: ${call.output !== undefined ? diff(call.output, output!) : `sha ${sha256(output!).slice(0, 12)} != ${call.sha?.slice(0, 12)}`}`);
    }
  });
  const state = sha256(pyDumps([...store.resources.entries()]));
  if (state !== episode.state.sha) problems.push(`${episode.id}: final chart state differs (${store.resources.size} resources, Python ${episode.state.resources})`);
  if (store.audit.length !== episode.state.audit) problems.push(`${episode.id}: audit ${store.audit.length} != ${episode.state.audit}`);
  if (JSON.stringify([...store.deleted].sort()) !== JSON.stringify(episode.state.deleted)) problems.push(`${episode.id}: deleted ${[...store.deleted].sort()} != ${episode.state.deleted}`);
  if (store.events.length !== episode.state.events) problems.push(`${episode.id}: events ${store.events.length} != ${episode.state.events}`);
  return problems;
}

describe.skipIf(skip !== null)('store parity with fhir_query_rl.store', () => {
  const all = skip === null ? episodes() : [];
  const sources = [...new Set(all.map((e) => e.source))];
  for (const source of sources) {
    it(`replays every ${source} episode byte for byte`, () => {
      const group = all.filter((e) => e.source === source);
      const problems = group.flatMap(check);
      expect(problems.length, `${group.length - new Set(problems.map((p) => p.split(' ')[0])).size}/${group.length} episodes match; first problems:\n${problems.slice(0, 5).join('\n')}`).toBe(0);
    });
  }
});

describe.runIf(skip !== null)('store parity (skipped)', () => {
  it.skip(`skipped: ${skip}`, () => {});
});
