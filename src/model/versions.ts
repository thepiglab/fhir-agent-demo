// Model versions, without the runtime (so tests can import them): the "-v<N>" in a file name,
// and the Hugging Face repo a resolve URL points into.

/** A model file's version, from the "-v<N>" in its name: "LFM3-FHIR-demo-v2-Q4_K_M.gguf" → 2. */
export function modelVersion(urlOrFile: string): number | null {
  const m = /-v(\d+)(?=[-_.])/i.exec(urlOrFile.split('/').pop() ?? '');
  return m ? Number(m[1]) : null;
}
/** "owner/repo" of a Hugging Face resolve URL, else null. */
export function hubRepo(url: string): string | null {
  return /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\//.exec(url)?.[1] ?? null;
}
/** A model file's quantization key: its name without the "-v<N>" version, so v2 and v3 of Q4_K_M match. */
export function variantKey(urlOrFile: string): string {
  return (urlOrFile.split('/').pop() ?? '').replace(/-v\d+(?=[-_.])/i, '').toLowerCase();
}
/**
 * Does the model at `url` replace the saved one at `saved`? Yes for another version or pin of the same
 * quantization from the same Hugging Face repo (v2 Q4_K_M for v3 Q4_K_M); no for the picker's other
 * quantizations, which share the repo but are kept until the visitor removes them.
 */
export function replaces(url: string, saved: string): boolean {
  if (saved === url) return false;
  const repo = hubRepo(url);
  if (repo ? hubRepo(saved) !== repo : saved.split('/').pop() !== url.split('/').pop()) return false;
  return variantKey(saved) === variantKey(url);
}
