import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODEL_RUNTIME, activeRuntime, isModelRuntime } from '../src/model/config.ts';

describe('model runtime switch', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('defaults to the runtime of the default model (2-bit: lowbit)', () => {
    expect(MODEL_RUNTIME).toBe('lowbit');
    expect(activeRuntime()).toBe(MODEL_RUNTIME);
  });

  it('takes ?runtime= from the page URL, and ignores anything else', () => {
    vi.stubGlobal('location', { search: '?runtime=lowbit&model=models/x-Q2_K.gguf' });
    expect(activeRuntime()).toBe('lowbit');
    vi.stubGlobal('location', { search: '?runtime=vendored' });
    expect(activeRuntime()).toBe('vendored');
    vi.stubGlobal('location', { search: '?runtime=wasm' });
    expect(activeRuntime()).toBe(MODEL_RUNTIME);
    expect(isModelRuntime('lowbit')).toBe(true);
    expect(isModelRuntime('Lowbit')).toBe(false);
  });
});
