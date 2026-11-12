import { describe, expect, it } from 'vitest';
import { MODEL } from '../src/model/config.ts';
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
  it('sees the pinned model as a newer version of a saved v2 in the same repo (the update path)', () => {
    // A browser with v2 saved: v3's URL is new (nothing stored for it), the page downloads it, and
    // pruneStale removes v2 because it is another file of the same Hugging Face repo.
    const v2 = 'https://huggingface.co/mkieffer/LFM3-FHIR-demo-v1/resolve/d6c2dc59092969aede3650167fb899632e719342/LFM3-FHIR-demo-v2-Q4_K_M.gguf';
    const [owner, repoAt, ...file] = MODEL.split('/');
    const v3 = `https://huggingface.co/${owner}/${repoAt!.split('@')[0]}/resolve/${repoAt!.split('@')[1]}/${file.join('/')}`;
    expect(hubRepo(v3)).toBe(hubRepo(v2));
    expect(v3).not.toBe(v2);
    expect(modelVersion(v3)!).toBeGreaterThan(modelVersion(v2)!);
  });
});
