// Answer lists are order-free in the demo's grading unless the request asks for an order (as
// v0.6.2); the v0.6 port stays in-order by default so the Python parity goldens still hold.
import { describe, expect, it } from 'vitest';
import { answerEqual, fieldMatches } from '../src/fhir/scoring.ts';

const gold = ['Amlodipine', 'Hydrochlorothiazide', 'Lisinopril'];
const given = ['Lisinopril', 'Hydrochlorothiazide', 'Amlodipine'];
const ask = 'SYN-48e43056a8 hypertension - give most recent blood pressure date, days since 2025-05-14, and list active home antihypertensive meds.\nReply with only JSON: …';

describe('answer list order', () => {
  it('accepts the same list in another order', () => {
    expect(fieldMatches(gold, given, ask)).toBe(true);
  });
  it('still needs the same items, each once', () => {
    expect(fieldMatches(gold, ['Lisinopril', 'Lisinopril', 'Amlodipine'], ask)).toBe(false);
    expect(fieldMatches(gold, ['Lisinopril', 'Amlodipine'], ask)).toBe(false);
  });
  it('keeps order when the request asks for one', () => {
    expect(fieldMatches(gold, given, 'List the doses oldest first.')).toBe(false);
    expect(fieldMatches(gold, gold, 'List the doses oldest first.')).toBe(true);
  });
  it('ignores alphabetical and bare "sorted" requests', () => {
    expect(fieldMatches(gold, given, 'List the meds sorted alphabetically.')).toBe(true);
    expect(fieldMatches(gold, given, 'List the meds, sorted.')).toBe(true);
  });
  it('leaves the v0.6 default (parity) in order', () => {
    expect(answerEqual(gold, given)).toBe(false);
  });
});
