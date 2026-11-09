// The answer card's reference range and flag (src/chat/conversation/answer.ts rangeOf), and the
// stat block that carries them, built from a cited Observation.
import { describe, expect, it } from 'vitest';
import { plan, rangeOf } from '../src/chat/conversation/answer.ts';
import type { Ctx, RecordFacts } from '../src/chat/conversation/answer.ts';
import type { RecordView } from '../src/chat/conversation/hooks.ts';
import type { RunTrace } from '../src/chat/conversation/types.ts';

const facts = (low: number | null, high: number | null): RecordFacts => ({ ref: 'Observation/h', name: 'Hemoglobin', code: '718-7', value: 11.5, unit: 'g/dL', date: '2023-02-10', status: 'final', low, high });

describe('reference range', () => {
  it('words the range and flags a value outside it', () => {
    expect(rangeOf(11.5, facts(12, 16))).toEqual({ range: '12 to 16 g/dL', flag: 'low' });
    expect(rangeOf(14.2, facts(12, 16))).toEqual({ range: '12 to 16 g/dL', flag: null });
    expect(rangeOf(17, facts(12, 16)).flag).toBe('high');
    expect(rangeOf(1, facts(null, 5)).range).toBe('up to 5 g/dL');
    expect(rangeOf(1, null)).toEqual({ range: null, flag: null });
  });

  it('puts it on the stat of a cited result', () => {
    const record = {
      ref: 'Observation/h', label: 'Hemoglobin', date: '2023-02-10', status: 'final',
      resource: {
        resourceType: 'Observation', status: 'final', effectiveDateTime: '2023-02-10',
        code: { coding: [{ system: 'http://loinc.org', code: '718-7' }], text: 'Hemoglobin' },
        valueQuantity: { value: 11.5, unit: 'g/dL' }, referenceRange: [{ low: { value: 12 }, high: { value: 16 } }],
      },
    } as unknown as RecordView;
    const trace = { final: { shown: { value: 11.5, unit: 'g/dL', date: '2023-02-10' }, evidence: ['Observation/h'], claims: [], names: {} }, sources: [] } as unknown as RunTrace;
    const ctx: Ctx = { names: {}, claims: new Map(), sources: new Map(), records: new Map([['Observation/h', record]]) };
    const [block] = plan(trace, ctx);
    expect(block).toMatchObject({ kind: 'stat', value: 11.5, unit: 'g/dL', range: '12 to 16 g/dL', flag: 'low' });
  });
});
