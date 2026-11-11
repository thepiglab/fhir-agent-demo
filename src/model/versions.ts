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
