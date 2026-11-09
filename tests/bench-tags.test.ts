// The picker's release tags (src/chat/benchmark/logic.ts): random and default picks lean to
// medium and hard questions unless a difficulty filter is on, and the negatives filter is a
// developer-view one. Checked on the exported natural v0.2.3 questions where they are present.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { QuestionRow } from '../src/chart/data.ts';

// The app state reads a media query and the page body at import; the picker logic needs neither.
const media = { matches: false, addEventListener() {}, removeEventListener() {} };
vi.stubGlobal('window', { matchMedia: () => media, addEventListener() {}, location: { hash: '', search: '', href: 'http://demo.test/' } });
vi.stubGlobal('document', { body: { classList: { toggle() {}, add() {}, remove() {} } }, getElementById: () => null, addEventListener() {} });

const { app } = await import('../src/app/state.ts');
const { harder, matches, NO_FILTERS } = await import('../src/chat/benchmark/logic.ts');

const row = (id: string, extra: Partial<QuestionRow>): QuestionRow => ({
  id, patient: 'p', family: 'f', label: 'f', purpose: 'decision support', task_type: 'lookup', tier: null, track: null,
  persona: 'physician', style: 'clean', premise: true, read_only: true, crud: null, reference_calls: null, ...extra,
});

describe('picker tags', () => {
  const rows = [row('e', { difficulty: 'easy' }), row('m', { difficulty: 'medium' }), row('h', { difficulty: 'hard' })];

  it('random picks prefer medium and hard, unless a difficulty is chosen', () => {
    expect(harder(rows, NO_FILTERS).map((r) => r.id)).toEqual(['m', 'h']);
    expect(harder(rows, { ...NO_FILTERS, difficulty: 'easy' }).map((r) => r.id)).toEqual(['e', 'm', 'h']);
    // A pool with only easy questions, or a release without tags, is left as it is.
    expect(harder([rows[0]!], NO_FILTERS).map((r) => r.id)).toEqual(['e']);
    expect(harder([row('x', {})], NO_FILTERS).map((r) => r.id)).toEqual(['x']);
  });

  it('filters negatives by kind in the developer view only', () => {
    const neg = row('n', { negative: true, negative_kind: 'wrong date', negative_new: true });
    const old = row('o', { negative: true, negative_kind: 'never low', negative_new: false });
    const f = { ...NO_FILTERS, negative: 'new' };
    app.dev = false;
    expect([neg, old, rows[0]!].filter((r) => matches(r, f)).length).toBe(3);
    app.dev = true;
    try {
      expect([neg, old, rows[0]!].filter((r) => matches(r, f)).map((r) => r.id)).toEqual(['n']);
      expect([neg, old, rows[0]!].filter((r) => matches(r, { ...NO_FILTERS, negative: 'any' })).map((r) => r.id)).toEqual(['n', 'o']);
      expect([neg, old].filter((r) => matches(r, { ...NO_FILTERS, negative: 'never low' })).map((r) => r.id)).toEqual(['o']);
    } finally {
      app.dev = false;
    }
  });

  const exported = new URL('../public/data/natural-v0.2.3/questions.json', import.meta.url);
  it.skipIf(!existsSync(exported))('the export carries the v0.2.3 tags and the four new negative kinds', () => {
    const all = JSON.parse(readFileSync(exported, 'utf8')) as QuestionRow[];
    expect(all.every((r) => r.persona && r.persona !== 'keyed')).toBe(true);
    expect(new Set(all.map((r) => r.difficulty))).toEqual(new Set(['easy', 'medium', 'hard']));
    expect(all.every((r) => typeof r.specialty === 'string' && typeof r.purpose === 'string')).toBe(true);
    const kinds = new Set(all.filter((r) => r.negative_new).map((r) => r.negative_kind));
    expect(kinds).toEqual(new Set(['drug never taken', 'wrong date', 'not in your records', 'decline advice']));
    expect(all.filter((r) => r.negative && !r.negative_new).length).toBeGreaterThan(0);
  });
});
