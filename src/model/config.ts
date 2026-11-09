// Where the demo gets its weights. This is the one value to change when the model moves.
//
// "owner/repo/file.gguf" downloads https://huggingface.co/owner/repo/resolve/main/file.gguf
// (Hugging Face serves byte ranges and CORS, which the runtime needs). A relative path such
// as "models/file.gguf" loads from this site instead: the dev and preview servers serve the
// git-ignored models/ folder (vite.config.ts); a deployed site has no such folder.
// The page's ?model=<path or owner/repo/file> overrides it, e.g. for local testing.
// Pinned to the Hugging Face commit that holds SFT v0.6.1 (sha256 below), so a browser that
// cached the previous model (SFT v0.5.1, same file name) downloads the new one.
export const MODEL = 'mkieffer/LFM3-FHIR-demo-v1@8ca16a0671e2e5458531b5d7295081acf5811e2d/LFM3-FHIR-demo-v1-Q4_K_M.gguf';
/** The pinned file, as Hugging Face reports it (X-Linked-ETag, X-Linked-Size). */
export const MODEL_FILE = { sha256: '8ef448bc1e8cd6bc456c02294ee99eb436e54c6a43d9684a629937c248fc9cf3', bytes: 1_099_627_360 };
/** Repetition penalty for the model above (1 = off; HF/vLLM semantics, applied on the GPU by the patched
 * runtime). The model carries its own: SFT v0.6.1 L scored worse with 1.1 (6/12 vs 8/12), while the RL
 * checkpoints scored better (docs/research/webgpu-repetition-penalty.md). Change it together with MODEL. */
export const MODEL_REPETITION_PENALTY = 1;

// Shown on the page next to the model. Facts about the weights MODEL points at.
export const MODEL_FACTS = {
  name: 'LFM3 1.7B EHR agent (SFT v0.6.1)',
  base: 'LiquidAI/LFM3-1.7B (LFM Open License)',
  training: 'Supervised fine-tune (SFT v0.6.1, best-of GPT-OSS 120B and Muse Glimmer 30B traces) of LFM3 1.7B to search FHIR records with one tool, fhir_request, and cite the records it used',
  quantization: 'llama.cpp Q4_K_M (stock tensor layout, which the WebGPU runtime requires)',
  result: 'Natural-prompt benchmark v0.2.2 (strict, full dev, BF16): 29.4%; Q4_K_M 28.2% vs 29.1% BF16 on the quantization subset.',
};

export const CONTEXT_TOKENS = 16384;  // Pillar 6 budget: an L episode fits in 16K tokens

// The harness the model was trained in, which the Chart assistant must run it in:
//   'L'    the locked harness (fhir_request, results as JSON): SFT v0.6.1 and earlier;
//   'X16'  harness-suite profile X16 (Context-1 at 16,384 tokens: handles, prune, budget line,
//          overflow, dedup stubs, turn ramp): LFM3 SFT v0.6.1-X16. src/fhir/context1.ts.
//   'X16v2' X16 with exact token counts (LFM3's tokenizer), a hard cap on real prompt tokens and
//          pruning to 60%: the LFM3 RL checkpoint. src/fhir/context1_v2.ts.
// Switch to 'X16' together with MODEL when the v0.6.1-X16 GGUF is staged. ?harness=L|X16 in the
// page URL overrides it (for testing; L stays as the fallback). ?harness=X16v2 likewise.
export type Harness = 'L' | 'X16' | 'X16v2';
export const MODEL_HARNESS: Harness = 'L';
const HARNESS_KEY = 'fhir-demo-harness';
const isHarness = (v: unknown): v is Harness => v === 'X16' || v === 'X16v2' || v === 'L';
const developerView = (): boolean => {
  try { return JSON.parse(globalThis.localStorage?.getItem('fhir-demo-dev') ?? 'false') === true; } catch { return false; }
};
/** The harness a run uses: ?harness= in the URL, else the developer view's choice (⋯ menu), else MODEL_HARNESS. */
export function activeHarness(): Harness {
  const wanted = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('harness');
  if (isHarness(wanted)) return wanted;
  if (developerView()) {
    try { const stored = JSON.parse(globalThis.localStorage?.getItem(HARNESS_KEY) ?? 'null'); if (isHarness(stored)) return stored; } catch { /* storage unavailable */ }
  }
  return MODEL_HARNESS;
}
/** The developer view's harness choice (null: the model's own, MODEL_HARNESS). */
export function chosenHarness(): Harness | null {
  try { const v = JSON.parse(globalThis.localStorage?.getItem(HARNESS_KEY) ?? 'null'); return isHarness(v) ? v : null; } catch { return null; }
}
export function setChosenHarness(h: Harness | null): void {
  try { if (h) globalThis.localStorage?.setItem(HARNESS_KEY, JSON.stringify(h)); else globalThis.localStorage?.removeItem(HARNESS_KEY); } catch { /* storage unavailable */ }
}

export const LONG_CONTEXT_TOKENS = 24_576;
const LONG_KEY = 'fhir-demo-long-charts';
/** The "Long charts" setting (⋯ menu): a 24,576-token context, for charts whose questions outgrow 16K. */
export function longCharts(): boolean {
  try { return JSON.parse(globalThis.localStorage?.getItem(LONG_KEY) ?? 'false') === true; } catch { return false; }
}
export function setLongCharts(on: boolean): void {
  try { globalThis.localStorage?.setItem(LONG_KEY, JSON.stringify(on)); } catch { /* storage unavailable */ }
}

/**
 * The runtime's context (tokens) for this page: 16,384 for both harnesses (Pillar 6). X16's budget
 * is an estimate, and 9.8% of SFT v0.6.1-X16 dev runs have a call past 16K, but rescored with a real
 * 16K cap the model drops only from 36.0% to 35.5% natural safe (most of those runs failed anyway),
 * so 16K stays the default and an over-long question ends with a "too long" message. "Long charts"
 * raises it to 24,576. ?ctx=<tokens> in the page URL overrides both (measurement).
 */
export function contextTokens(): number {
  const wanted = typeof location === 'undefined' ? NaN : Number(new URLSearchParams(location.search).get('ctx'));
  if (Number.isInteger(wanted) && wanted >= 4096 && wanted <= 65536) return wanted;
  return longCharts() ? LONG_CONTEXT_TOKENS : CONTEXT_TOKENS;
}
