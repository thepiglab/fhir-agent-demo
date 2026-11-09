// changeView (src/chart/trace.ts) against demo/app.py's change_view on real sandbox writes.
// tests/fixtures/trace-changes.json is written by scripts/web_demo/make_change_fixtures.py:
// per patient, the store's audit entries, the records change_view can look at, their cards, and
// the Python result for each entry.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pyParse } from '../src/fhir/pyjson.ts';
import { changeView } from '../src/chart/trace.ts';
import type { AuditLike, CardTuple, ChangeView, JsonObject } from '../src/chart/trace.ts';

interface Case {
  patient: string;
  log: { call: string; status: number }[];
  entries: AuditLike[];
  resources: (JsonObject & { resourceType: string; id: string })[];
  cards: Record<string, CardTuple>;
  expected: ChangeView[];
}

const { cases } = pyParse<{ cases: Case[] }>(readFileSync(new URL('./fixtures/trace-changes.json', import.meta.url), 'utf8'));

describe('changeView matches demo/app.py change_view', () => {
  it('has fixtures covering create, update and delete', () => {
    const methods = new Set(cases.flatMap((c) => c.entries.map((e) => e.method)));
    expect([...methods].sort()).toEqual(['DELETE', 'POST', 'PUT']);
    expect(cases.reduce((n, c) => n + c.entries.length, 0)).toBeGreaterThan(20);
  });
  for (const c of cases) {
    it(`patient ${c.patient}`, () => {
      const resources = new Map(c.resources.map((r) => [`${r.resourceType}/${r.id}`, r]));
      const inputs = { names: {}, cards: c.cards, resources };
      const got = c.entries.map((entry) => changeView(entry, inputs));
      // Compared as JSON text, so key order, floats and nulls all count.
      expect(JSON.parse(JSON.stringify(got))).toEqual(JSON.parse(JSON.stringify(c.expected)));
    });
  }
});
