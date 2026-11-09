// The answer's trend block (src/chat/conversation/answer.ts): a line chart only when the cited
// records give at least MIN_CHART_POINTS values of one test; fewer go in a short table.
import { describe, expect, it } from 'vitest';
import { MIN_CHART_POINTS, plan } from '../src/chat/conversation/answer.ts';
import type { Ctx } from '../src/chat/conversation/answer.ts';
import type { RecordView } from '../src/chat/conversation/hooks.ts';
import type { RunTrace } from '../src/chat/conversation/types.ts';

function hemoglobin(n: number): { trace: RunTrace; ctx: Ctx } {
  const records = new Map<string, RecordView>();
  const refs: string[] = [];
  for (let i = 0; i < n; i++) {
    const ref = `Observation/h${i}`;
    refs.push(ref);
    records.set(ref, {
      ref, label: 'Hemoglobin', date: `2023-0${i + 1}-10`, status: 'final',
      resource: {
        resourceType: 'Observation', status: i === 1 ? 'corrected' : 'final', effectiveDateTime: `2023-0${i + 1}-10`,
        code: { coding: [{ system: 'http://loinc.org', code: '718-7' }], text: 'Hemoglobin' },
        valueQuantity: { value: 12 + i / 2, unit: 'g/dL' },
      },
    } as unknown as RecordView);
  }
  const trace = { final: { shown: { summary: 'See the values' }, evidence: refs, claims: [], names: {} }, sources: [] } as unknown as RunTrace;
  return { trace, ctx: { names: {}, claims: new Map(), sources: new Map(), records } };
}

describe('trend block', () => {
  it('charts a series of three or more values', () => {
    const { trace, ctx } = hemoglobin(MIN_CHART_POINTS);
    const [first] = plan(trace, ctx);
    expect(first?.kind).toBe('trend');
  });

  it('puts two values in a short table instead of a chart', () => {
    const { trace, ctx } = hemoglobin(2);
    const blocks = plan(trace, ctx);
    expect(blocks.some((b) => b.kind === 'trend')).toBe(false);
    const table = blocks[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(table.columns.map((c) => c.key)).toEqual(['date', 'value', 'status']);
    expect(table.rows.map((r) => r.item)).toEqual([
      { date: '2023-01-10', value: 12, unit: 'g/dL', status: 'final' },
      { date: '2023-02-10', value: 12.5, unit: 'g/dL', status: 'corrected' },
    ]);
  });
});
