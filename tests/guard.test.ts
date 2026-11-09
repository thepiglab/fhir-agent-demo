// The per-turn thinking guard (src/chart/guard.ts): a loop ends a turn at once, a long but varied
// thought only at the budget, and ordinary thinking never.
import { describe, expect, it } from 'vitest';
import { LOOP_REPEATS, jaccard, sentenceTokens, thinkingGuard } from '../src/chart/guard.ts';
import { RL_ENCOUNTER_LOOP, RL_RECOVERS, RL_TASK_LOOP } from './fixtures/rl-step200-thinking.ts';

const feed = (pieces: string[], budget?: number) => {
  const g = thinkingGuard(budget);
  for (let i = 0; i < pieces.length; i++) { const stop = g.feed(pieces[i]!); if (stop) return { stop, at: i + 1 }; }
  return { stop: null, at: pieces.length };
};

describe('thinking guard', () => {
  it('stops the HbA1c loop: one LOINC code repeated', () => {
    const intro = 'We need HbA1c. LOINC codes: 4548-4, 17856-6, '.split(/(?<= )/);
    const loop = Array.from({ length: 200 }, () => ['718', '-7', ', ']).flat();
    const r = feed([...intro, ...loop]);
    expect(r.stop).toBe('thinking_loop');
    expect(r.at).toBeLessThan(intro.length + 3 * (LOOP_REPEATS + 4));  // within a few repeats past the threshold
  });

  it('leaves ordinary thinking alone, and stops a long varied one at the budget', () => {
    const words = Array.from({ length: 400 }, (_, i) => `step${i} `);
    expect(feed(words).stop).toBeNull();
    expect(feed(words, 100)).toEqual({ stop: 'thinking_budget', at: 101 });
  });

  it('does not take short legitimate repeats for a loop', () => {
    // A few repeats (a list of dates, "==" in code) stay under LOOP_REPEATS.
    const text = 'Dates: 2023-01-01, 2023-01-01, 2023-01-01. Then check Observation?code=718-7 and compare. '.split(/(?<= )/);
    expect(feed([...text, ...text, ...text]).stop).toBeNull();
  });
});

describe('thinking guard, short runs', () => {
  it('ignores a run of one character or a zero-padded id', () => {
    expect(feed(['Line ', '================', '========', ' then ', '0000000000000000', '00000 ', 'ok '].flatMap((x) => x.split(''))).stop).toBeNull();
  });
});

// Near-duplicate sentence loops: RL L step 200's thinking at T 0.1 without a repetition penalty
// (recorded in the browser, 2026-11-09; the exact 80-character match missed both).
// Varied but similar-looking thinking that must pass: a list of lab values, one per line.
const LAB_LIST = `We have hemoglobin observations:
- 2020-11-17: 13.0 g/dL, Observation/80f87f87aa01, final
- 2021-07-25: 11.6 g/dL, Observation/718bbbc2de02, final
- 2021-08-09: 14.4 g/dL, Observation/3d15f0200d03, final
- 2021-09-05: 15.0 g/dL, Observation/1ff3bb77f604, final
- 2021-09-20: 14.8 g/dL, Observation/a0fe86e28c05, final
- 2021-09-28: 14.9 g/dL, Observation/9c0e1d2f3a06, final
The low value was 2021-07-25. The next ServiceRequest is 2021-08-09, so that is the recheck.
`;
const tokensOf = (text: string) => text.split(/(?<=\s)/);

describe('thinking guard, sentence loops', () => {
  it('stops both RL step 200 loops before the budget', () => {
    for (const text of [RL_TASK_LOOP, RL_ENCOUNTER_LOOP]) {
      const pieces = tokensOf(text);
      const r = feed(pieces);
      expect(r.stop).toBe('thinking_loop');
      expect(r.at).toBeLessThan(pieces.length);
    }
  });

  it('lets RL dithering through when the model recovers (cancel_referral, answered correctly)', () => {
    expect(feed(tokensOf(RL_RECOVERS)).stop).toBeNull();
  });

  it('leaves a list of lab values alone', () => {
    expect(feed(tokensOf(LAB_LIST)).stop).toBeNull();
  });

  it('masks ids but keeps short numbers', () => {
    expect([...sentenceTokens('Search Task?identifier=DUP-a6f0fb23 for 2021-07-25')]).toEqual(['search', 'task', 'identifier', 'dup', '#id', 'for', '2021', '07', '25']);
    expect(jaccard(sentenceTokens('try Task identifier DUP-a6f0fb23 now'), sentenceTokens('try Task identifier DUP-b7e1ac34 now'))).toBe(1);
  });
});

describe('thinking guard, buffered chunks', () => {
  it('counts a long buffered chunk by its length, not as one token', () => {
    const g = thinkingGuard(100);
    expect(g.feed('word ')).toBeNull();
    expect(g.feed('x'.repeat(400) + ' ')).toBe('thinking_budget');  // ~101 tokens
    expect(g.tokens()).toBe(1 + 101);
  });
});
