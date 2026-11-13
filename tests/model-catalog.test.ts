import { afterEach, describe, expect, it, vi } from 'vitest';
import { BF16_SCORE, DEFAULT_MODEL_ID, RECOMMENDED, MODEL_OPTIONS, modelOption, selectedOption, uploaded } from '../src/model/catalog.ts';
import { replaces, variantKey } from '../src/model/versions.ts';

const hf = (commit: string, file: string) => `https://huggingface.co/mkieffer/LFM3-FHIR-demo-v1/resolve/${commit}/${file}`;

describe('model picker catalog', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('offers 4-bit on the vendored runtime and 3-bit, 2-bit and ternary on the lowbit runtime', () => {
    expect(MODEL_OPTIONS.map((o) => [o.id, o.runtime])).toEqual([['q4', 'vendored'], ['q3', 'lowbit'], ['q2', 'lowbit'], ['ternary', 'lowbit']]);
    for (const o of MODEL_OPTIONS) {
      expect(o.harness).toBe('Lc');
      expect(o.memory.bytes).toBeGreaterThan(o.file.bytes);
      expect(o.memory.how.length).toBeGreaterThan(20);
      expect(o.score).toBeLessThanOrEqual(BF16_SCORE);
    }
    // Downloads shrink with the bits, and every file name is distinct (its own cache entry).
    const sizes = MODEL_OPTIONS.map((o) => o.file.bytes);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
    expect(new Set(MODEL_OPTIONS.map((o) => variantKey(o.spec))).size).toBe(MODEL_OPTIONS.length);
    expect(modelOption('ternary').experimental).toBe(true);
  });

  it('recommends exactly one option, 4-bit for now, and defaults to it', () => {
    expect(MODEL_OPTIONS.filter((o) => o.recommended).map((o) => o.id)).toEqual(['q4']);
    expect(RECOMMENDED.recommended!.reason).toMatch(/^Fastest in the browser today/);
    expect(DEFAULT_MODEL_ID).toBe(RECOMMENDED.id);
  });

  it('runs the default unless the URL or a saved choice names an option', () => {
    expect(selectedOption().id).toBe(DEFAULT_MODEL_ID);
    for (const o of MODEL_OPTIONS) expect(uploaded(o)).toBe(true);
    expect(new Set(MODEL_OPTIONS.map((o) => o.spec.split('@')[1]!.split('/')[0])).size).toBe(1);
    vi.stubGlobal('location', { search: '?quant=q2' });
    expect(selectedOption().id).toBe('q2');
    vi.stubGlobal('location', { search: '?quant=q9' });
    expect(selectedOption().id).toBe(DEFAULT_MODEL_ID);
  });

  it('replaces an older version of the same quantization, and keeps the other quantizations', () => {
    const v2q4 = hf('d6c2dc5', 'LFM3-FHIR-demo-v2-Q4_K_M.gguf');
    const v3q4 = hf('abc1234', 'LFM3-FHIR-demo-v3-Q4_K_M.gguf');
    const v3q2 = hf('def5678', 'LFM3-FHIR-demo-v3-Q2_K.gguf');
    const v3q2main = hf('main', 'LFM3-FHIR-demo-v3-Q2_K.gguf');
    expect(replaces(v3q4, v2q4)).toBe(true);
    expect(replaces(v3q2, v3q2main)).toBe(true);
    expect(replaces(v3q2, v3q4)).toBe(false);
    expect(replaces(v3q4, v3q2)).toBe(false);
    expect(replaces(v3q4, v3q4)).toBe(false);
    expect(replaces(v3q4, 'https://huggingface.co/someone/else/resolve/x/LFM3-FHIR-demo-v2-Q4_K_M.gguf')).toBe(false);
  });
});

import { fullyStored, optionView } from '../src/model/option-view.ts';
describe('picker view (shared by the landing page and the Chart assistant)', () => {
  it('labels sizes, memory, badges and the sibling-score note', () => {
    const q4 = optionView(modelOption('q4'));
    expect(q4.download).toBe('1.1 GB');
    expect(q4.badges.map((b) => b.label)).toEqual(['Recommended']);
    expect(q4.qualityNote).toBeNull();
    const q2 = optionView(modelOption('q2'));
    expect(q2.download).toBe('755 MB');
    expect(q2.memoryShort).toBe('1.2 GB GPU memory');
    expect(q2.qualityShort).toBe('59.3% on held-out questions*');
    expect(q2.qualityNote).toMatch(/non-e4 sibling/);
    expect(optionView(modelOption('ternary')).badges.map((b) => b.label)).toEqual(['Experimental']);
    expect(q2.label).toBe('2-bit (Q2_K), 755 MB download');
  });
  it('counts a model as saved once (nearly) all of it is stored', () => {
    expect(fullyStored(modelOption('q4'), 1_091_380_480)).toBe(true);   // the vendored runtime's tensor ranges
    expect(fullyStored(modelOption('q2'), 754_948_960)).toBe(true);
    expect(fullyStored(modelOption('q2'), 400_000_000)).toBe(false);
  });
});
