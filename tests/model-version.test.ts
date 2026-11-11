import { describe, expect, it } from 'vitest';
import { hubRepo, modelVersion } from '../src/model/versions.ts';

describe('model versions', () => {
  it('reads the -v<N> in a file name or URL', () => {
    expect(modelVersion('LFM3-FHIR-demo-v2-Q4_K_M.gguf')).toBe(2);
    expect(modelVersion('https://huggingface.co/mkieffer/LFM3-FHIR-demo-v1/resolve/abc/LFM3-FHIR-demo-v1-Q4_K_M.gguf')).toBe(1);
    expect(modelVersion('LFM3-FHIR-demo-v12.gguf')).toBe(12);
    expect(modelVersion('model-Q4_K_M.gguf')).toBeNull();
  });
  it('names the Hugging Face repo of a resolve URL', () => {
    expect(hubRepo('https://huggingface.co/mkieffer/LFM3-FHIR-demo-v1/resolve/d6c2dc5/LFM3-FHIR-demo-v2-Q4_K_M.gguf')).toBe('mkieffer/LFM3-FHIR-demo-v1');
    expect(hubRepo('http://localhost:5179/models/x.gguf')).toBeNull();
  });
});
