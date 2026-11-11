// The per-model prompt layouts (src/chart/prompt.ts) against the exact v0.2.3.5 prompts of the
// demo's 36 held-out questions (better-questions' package lfm3-prompt-v0235, verified on real
// episodes): system and user turns byte for byte.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { askSystem, splitContract, taskMessages } from '../src/chart/prompt.ts';

const dir = new URL('./fixtures/prompt-v0235/', import.meta.url);
const base = readFileSync(new URL('base_system_prompt.txt', dir), 'utf8');
const conventions = readFileSync(new URL('charting_conventions_v0234.txt', dir), 'utf8');
const q36 = JSON.parse(readFileSync(new URL('q36_heldout_v0235_prompts.json', dir), 'utf8')) as
  { id: string; v0235: { system: string; user: string }; demo_v023: { user: string } }[];
const contractOf = (system: string) => system.split('\nAnswer contract for this request:\n')[1]!;

describe('prompt layouts', () => {
  it('base is config.json\'s system prompt', () => {
    const cfg = JSON.parse(readFileSync(new URL('../public/data/config.json', import.meta.url), 'utf8')) as { system_prompt: string };
    expect(cfg.system_prompt).toBe(base);
  });

  it('a v0.2.3.5 row in the v0.2.3.4 layout is the eval prompt, byte for byte (36/36)', () => {
    for (const q of q36) {
      const row = { prompt: q.v0235.user, answer_contract: contractOf(q.v0235.system), charting_conventions: conventions };
      expect(taskMessages('v0.2.3.4', base, row)).toEqual({ system: q.v0235.system, user: q.v0235.user });
    }
  });

  it('a v0.2.3 row in the v0.2.2 layout is what the demo sends today (36/36)', () => {
    for (const q of q36) expect(taskMessages('v0.2.2', base, { prompt: q.demo_v023.user })).toEqual({ system: base, user: q.demo_v023.user });
  });

  it('a v0.2.3 row in the v0.2.3.4 layout matches the eval where the contract wording did not change', () => {
    let same = 0;
    for (const q of q36) {
      const m = taskMessages('v0.2.3.4', base, { prompt: q.demo_v023.user }, conventions);
      expect(m.user).toBe(q.v0235.user);  // the question is identical
      if (m.system === q.v0235.system) same += 1;
    }
    expect(same).toBe(27);  // 9 contracts were reworded after v0.2.3: re-export from v0.2.3.5 to match all 36
  });

  it('the v0.2.3.4 layout without conventions refuses rather than sending a half prompt', () => {
    expect(() => taskMessages('v0.2.3.4', base, { prompt: q36[0]!.demo_v023.user })).toThrow(/conventions/);
  });

  it('keyed rows (no contract) keep BASE and the prompt in both layouts', () => {
    for (const layout of ['v0.2.2', 'v0.2.3.4'] as const) expect(taskMessages(layout, base, { prompt: 'GET the latest hemoglobin.' }, conventions)).toEqual({ system: base, user: 'GET the latest hemoglobin.' });
  });

  it('Ask mode: v0.2.2 keeps BASE; v0.2.3.4 adds the conventions, and a family contract when there is one', () => {
    expect(askSystem('v0.2.2', base, conventions, null)).toBe(base);
    expect(askSystem('v0.2.3.4', base, conventions, null)).toBe(`${base}\n${conventions}`);
    expect(askSystem('v0.2.3.4', base, conventions, 'Reply with only JSON: {}')).toBe(`${base}\n${conventions}\nAnswer contract for this request:\nReply with only JSON: {}`);
    expect(askSystem('v0.2.3.4', base, null, null)).toBe(base);
    expect(splitContract('Q?\nReply with only JSON: {}')).toEqual({ question: 'Q?', contract: 'Reply with only JSON: {}' });
  });
});
