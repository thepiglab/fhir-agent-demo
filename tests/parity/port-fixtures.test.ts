// Differential tests of the TypeScript port against CPython on inputs the golden corpus does
// not reach. The fixtures in tests/parity/fixtures/ come from scripts/web_demo/make_port_fixtures.py
// (Python 3.13, jsonschema 4.26.0, fhir_query_rl at the pinned commit): error messages with Python
// repr(), jsonschema error order, urllib.parse, int(), json.loads errors, and randomized store
// episodes (reads, writes, transactions, conditional creates; interfaces v0.4-v0.6).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { is_final, parse_object } from '../../src/fhir/protocol.ts';
import { pyDumps, pyParse } from '../../src/fhir/pyjson.ts';
import { casefold, parseQsl, pyInt, pyRepr, pyStrip, urlencode, urlsplit } from '../../src/fhir/pyrt.ts';
import type { Rec } from '../../src/fhir/pyrt.ts';
import { validate_contracts } from '../../src/fhir/contracts.ts';
import { setEnvData } from '../../src/fhir/envdata.ts';
import { episodeStore } from '../../src/fhir/store.ts';
import { coerce_typed_strings, validate_resource } from '../../src/fhir/validation.ts';
import { missingData, sha256, shard, task } from './load.ts';

const HERE = new URL('./fixtures/', import.meta.url);
const ENV = new URL('../../public/data/env/', import.meta.url);
const lines = (name: string): string[] => gunzipSync(readFileSync(new URL(name, HERE))).toString('utf8').split('\n').filter(Boolean);

/** The exception as "Class: message", like the fixtures spell Python's. */
function outcome(f: () => unknown): unknown {
  try {
    return f();
  } catch (error) {
    return `${(error as { kind?: string }).kind ?? (error as Error).name}: ${(error as Error).message}`;
  }
}

beforeAll(() => {
  setEnvData({
    schema: JSON.parse(readFileSync(new URL('fhir.schema.json', ENV), 'utf8')),
    contracts: JSON.parse(readFileSync(new URL('resource_contracts.json', ENV), 'utf8')),
  });
});

describe('validation against jsonschema 4.26.0', () => {
  interface Case { resource: Rec; validate: string; coerce: unknown; contracts: string }
  const cases = lines('validation-cases.jsonl.gz').map((l) => pyParse<Case>(l));

  it('validate_resource raises the same message (repr, error order, first four)', () => {
    const bad = cases.flatMap((c, n) => {
      const got = outcome(() => { validate_resource(c.resource); return ''; });
      return got === c.validate ? [] : [`#${n}\n python: ${c.validate}\n ts:     ${String(got)}`];
    });
    expect(bad.slice(0, 5).join('\n'), `${bad.length}/${cases.length} differ`).toBe('');
    expect(cases.filter((c) => c.validate).length).toBeGreaterThan(cases.length / 3);
  });

  it('coerce_typed_strings returns the same resource', () => {
    const bad = cases.flatMap((c, n) => {
      const got = outcome(() => pyDumps(coerce_typed_strings(c.resource)));
      const want = typeof c.coerce === 'string' ? c.coerce : pyDumps(c.coerce);
      return got === want ? [] : [`#${n}\n python: ${want.slice(0, 200)}\n ts:     ${String(got).slice(0, 200)}`];
    });
    expect(bad.slice(0, 5).join('\n'), `${bad.length}/${cases.length} differ`).toBe('');
  });

  it('validate_contracts raises the same message', () => {
    const bad = cases.flatMap((c, n) => {
      const got = outcome(() => { validate_contracts([c.resource]); return ''; });
      return got === c.contracts ? [] : [`#${n}\n python: ${c.contracts}\n ts:     ${String(got)}`];
    });
    expect(bad.slice(0, 5).join('\n'), `${bad.length}/${cases.length} differ`).toBe('');
  });
});

describe('Python runtime helpers', () => {
  interface Fixture {
    cases: { s: string; split: unknown; qsl0: unknown; qsl1: unknown; int: unknown; repr: string; urlencode: unknown; strip: string; lower: string; casefold: string }[];
    json: { t: string; fence: boolean; ok?: string; err?: string; final: unknown }[];
  }
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL('runtime-cases.json.gz', HERE))).toString('utf8')) as Fixture;

  it('urlsplit, parse_qsl, urlencode, int, repr, strip, lower and casefold agree', () => {
    const bad: string[] = [];
    const same = (what: string, s: string, py: unknown, ts: unknown) => {
      if (JSON.stringify(py) !== JSON.stringify(ts)) bad.push(`${what} ${JSON.stringify(s)}\n python: ${JSON.stringify(py)}\n ts:     ${JSON.stringify(ts)}`);
    };
    for (const c of fixture.cases) {
      same('urlsplit', c.s, c.split, outcome(() => { const r = urlsplit(c.s); return [r.scheme, r.netloc, r.path, r.query]; }));
      same('parse_qsl', c.s, c.qsl0, parseQsl(c.s, false));
      same('parse_qsl keep_blank', c.s, c.qsl1, parseQsl(c.s, true));
      same('int', c.s, c.int, outcome(() => pyInt(c.s)));
      same('repr', c.s, c.repr, pyRepr(c.s));
      same('urlencode', c.s, c.urlencode, outcome(() => urlencode([[c.s, [...c.s].reverse().join('')]])));
      same('strip', c.s, c.strip, pyStrip(c.s));
      same('lower', c.s, c.lower, c.s.toLowerCase());
      same('casefold', c.s, c.casefold, casefold(c.s));
    }
    expect(bad.slice(0, 5).join('\n'), `${bad.length} differ`).toBe('');
  });

  it('parse_object and is_final agree with protocol.py (messages included)', () => {
    const bad: string[] = [];
    for (const c of fixture.json) {
      const got = outcome(() => pyDumps(parse_object(c.t, c.fence)));
      const want = c.ok ?? c.err;
      // Integers beyond 2**53 are the one documented difference (JSON numbers are doubles here).
      if (got !== want && !/\d{17,}/.test(c.t)) bad.push(`${JSON.stringify(c.t)}\n python: ${want}\n ts:     ${String(got)}`);
      const final = outcome(() => is_final(c.t, c.fence));
      if (final !== c.final && !/\d{17,}/.test(c.t)) bad.push(`is_final ${JSON.stringify(c.t)}: python ${String(c.final)}, ts ${String(final)}`);
    }
    expect(bad.slice(0, 5).join('\n'), `${bad.length} differ`).toBe('');
  });
});

describe.skipIf(missingData() !== null)('randomized store episodes against FhirStore', () => {
  interface Fuzz {
    id: string; cohort: string; task_id: string; interface: string;
    calls: { turn: number; args: Record<string, unknown>; sha?: string; output?: string; raised?: string }[];
    state: { sha: string; audit: number; events: number; deleted: string[] };
    events: unknown[]; unsafe: number; next_id: number; observed: string[]; seen: string[]; exposed: Record<string, string[]>;
  }
  const episodes = lines('store-fuzz.jsonl.gz').map((l) => pyParse<Fuzz>(l));

  it('every response, the chart, events, audit, observed terms and exposure match', () => {
    const bad: string[] = [];
    for (const ep of episodes) {
      const t = task(ep.cohort, ep.task_id);
      const store = episodeStore(t, shard(ep.cohort, t.shard), 40, ep.interface);
      ep.calls.forEach((call, n) => {
        store.active_tool = 'fhir_request';
        store.agent_tools.push('fhir_request');
        store.round = call.turn;
        const a = call.args;
        const got = outcome(() => {
          if (ep.interface !== 'v0.4') return store.fhirRequestObject(a as never);
          const body = a.body_json ? pyParse(a.body_json as string) : null;
          const headers = a.headers_json ? pyParse<Record<string, string>>(a.headers_json as string) : {};
          return pyDumps(store.request(a.method as string, a.path as string, body, headers));
        });
        const where = `${ep.id} call ${n + 1} ${JSON.stringify(a).slice(0, 160)}`;
        if (call.raised !== undefined) {
          if (typeof got === 'string' && got.startsWith(call.raised.split(':')[0] + ':')) return;
          bad.push(`${where}: python raised ${call.raised}, ts gave ${String(got).slice(0, 100)}`);
        } else if (typeof got !== 'string' || (call.output !== undefined ? got !== call.output : sha256(got) !== call.sha)) {
          bad.push(`${where}: response differs\n python: ${(call.output ?? '').slice(0, 200)}\n ts:     ${String(got).slice(0, 200)}`);
        }
      });
      const checks: [string, unknown, unknown][] = [
        ['chart', sha256(pyDumps([...store.resources.entries()])), ep.state.sha],
        ['audit', store.audit.length, ep.state.audit],
        ['deleted', [...store.deleted].sort(), ep.state.deleted],
        ['events', pyDumps(store.events), pyDumps(ep.events)],
        ['unsafe_attempts', store.unsafe_attempts, ep.unsafe],
        ['next_id', store.next_id, ep.next_id],
        ['observed_terms', [...store.observed_terms].sort(), ep.observed],
        ['seen', [...store.seen].sort(), ep.seen],
        ['exposed', pyDumps(Object.fromEntries([...store.exposed].map(([k, v]) => [k, [...v].sort()]))), pyDumps(ep.exposed)],
      ];
      for (const [what, ts, py] of checks) if (JSON.stringify(ts) !== JSON.stringify(py)) bad.push(`${ep.id}: ${what} differs`);
    }
    expect(bad.slice(0, 6).join('\n'), `${bad.length} problems in ${episodes.length} episodes`).toBe('');
  });
});
