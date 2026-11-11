// Harness Lc (src/fhir/compact_v2.ts) against the Python at fhir_suite_harness 7da3ad1, byte for
// byte. fixtures/lc-golden.jsonl.gz holds Python's render_compact_v2 text and exposed fields for
// real store.request results from every served chart shard (searches over all 54 resource types,
// paging with next links, _include, empty results, values past the 300-character cut, reads,
// writes, errors) plus hand-made edge cases, and lc_system_prompt over the demo's prompts.
// Regenerate with scripts/lc_golden/ (gen_results.ts, then gen_golden.py at 7da3ad1).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { lcSystemPrompt, renderCompactV2 } from '../../src/fhir/compact_v2.ts';
import { pyParse } from '../../src/fhir/pyjson.ts';
import { sortedStrings } from '../../src/fhir/pyrt.ts';
import type { Rec } from '../../src/fhir/pyrt.ts';

type Golden =
  | { kind: 'render'; tag: string; result: string; text: string; exposed: Record<string, string[]> }
  | { kind: 'system'; tag: string; system: string; text: string };

const goldens = gunzipSync(readFileSync(new URL('fixtures/lc-golden.jsonl.gz', import.meta.url))).toString('utf8')
  .split('\n').filter(Boolean).map((line) => JSON.parse(line) as Golden);
const renders = goldens.filter((g): g is Extract<Golden, { kind: 'render' }> => g.kind === 'render');
const systems = goldens.filter((g): g is Extract<Golden, { kind: 'system' }> => g.kind === 'system');

describe('harness Lc: render_compact_v2 parity', () => {
  it('covers searches, paging, includes, long values, empty results, edge cases and non-search results', () => {
    const tags = new Set(renders.map((g) => g.tag.split(':')[0]));
    for (const t of ['search', 'page', 'page2', 'include', 'empty', 'read', 'write', 'error', 'edge']) expect(tags).toContain(t);
    expect(renders.some((g) => g.text.includes('chars; GET '))).toBe(true);
    expect(renders.some((g) => g.text.includes(' | (included)'))).toBe(true);
    expect(renders.some((g) => /\nnext: /.test(g.text))).toBe(true);
    expect(renders.length).toBeGreaterThan(500);
  });

  it('renders every golden result byte for byte, with the same exposed fields', () => {
    const failures: string[] = [];
    for (const g of renders) {
      const out = renderCompactV2(pyParse<Rec>(g.result));
      const exposed = Object.fromEntries([...out.exposed].map(([k, v]) => [k, sortedStrings(v)]));
      if (out.text !== g.text) failures.push(`${g.tag}: text differs`);
      else if (JSON.stringify(exposed) !== JSON.stringify(g.exposed)) failures.push(`${g.tag}: exposed differs`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('keeps non-search results as the locked JSON text', () => {
    for (const g of renders.filter((r) => /^(read|write|error)/.test(r.tag))) expect(g.text).toBe(g.result);
  });
});

describe('harness Lc: lc_system_prompt parity', () => {
  for (const g of systems) it(g.tag, () => expect(lcSystemPrompt(g.system)).toBe(g.text));
});
