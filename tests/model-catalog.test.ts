import { afterEach, describe, expect, it, vi } from 'vitest';
import { BF16_SCORE, DEFAULT_MODEL_ID, MODEL_OPTIONS, modelOption, selectedOption, uploaded } from '../src/model/catalog.ts';
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

  it('runs the default unless the URL or a saved choice names an option', () => {
    expect(selectedOption().id).toBe(DEFAULT_MODEL_ID);
    // Placeholder pins are choosable only in the dev server (vitest runs with DEV true).
    expect(uploaded(modelOption('q2'))).toBe(false);
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
