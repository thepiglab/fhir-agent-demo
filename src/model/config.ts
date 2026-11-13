// Where the demo gets its weights. This is the one value to change when the model moves.
//
// "owner/repo/file.gguf" downloads https://huggingface.co/owner/repo/resolve/main/file.gguf
// (Hugging Face serves byte ranges and CORS, which the runtime needs). A relative path such
// as "models/file.gguf" loads from this site instead: the dev and preview servers serve the
// git-ignored models/ folder (vite.config.ts); a deployed site has no such folder.
// The page's ?model=<path or owner/repo/file> overrides it, e.g. for local testing.
// v3: LoRA RL r32 step 200 on SFT v0.7-Lc (LFM3-FHIR-demo-v3-Q4_K_M.gguf, sha256 below), uploaded next
// to v1's and v2's files in the same repo and pinned to that upload's Hugging Face commit. The "-v<N>" in the file name is the model's
// version: the page compares it with what this browser has saved and with the newest file in the
// repo (src/model/model.ts, savedModels and latestOnHub). It runs in the Lc harness (MODEL_HARNESS below).
//
// The model picker (src/model/catalog.ts) offers v3 at 4, 3 and 2 bits and ternary. MODEL and the settings
// below come from the chosen option (MODEL_OPTION): set them there, not here.
import { isPromptLayout } from '../chart/prompt.ts';
import type { PromptLayout } from '../chart/prompt.ts';
import { selectedOption } from './catalog.ts';
import type { ModelOption } from './catalog.ts';

/** The option this page runs (the picker's choice, ?quant=, or DEFAULT_MODEL_ID). */
export const MODEL_OPTION: ModelOption = selectedOption();
// HF_COMMIT_V3 in the catalog is a placeholder for the upload's Hugging Face commit (all four files).
export const MODEL = MODEL_OPTION.spec;
/** The pinned file, as Hugging Face reports it (X-Linked-ETag, X-Linked-Size). */
export const MODEL_FILE = MODEL_OPTION.file;
/**
 * The WebGPU runtime that runs MODEL. Change it together with MODEL.
 *   'vendored'  vendor/lfm3-webgpu-pi: the webml-community runtime, patched. Q4_K_M/Q6_K GGUFs in the stock
 *               tensor layout only; it needs 16-bit shaders for full speed.
 *   'lowbit'    vendor/lfm3-lowbit: fhir-env's lowbit runtime (Rust/wasm + core WGSL). GGUF blocks stay
 *               packed in VRAM, for 1- to 4-bit files (Q1_0, Q2_0, TQ2_0, Q2_K to Q6_K, Q8_0); same API,
 *               same weights cache (gguf-cache-v1), its own chat template and tool-call parser from the GGUF.
 * The page's ?runtime=vendored|lowbit overrides it, e.g. with ?model= for a low-bit file.
 */
export type ModelRuntime = 'vendored' | 'lowbit';
export const MODEL_RUNTIME: ModelRuntime = MODEL_OPTION.runtime;
export const isModelRuntime = (v: unknown): v is ModelRuntime => v === 'vendored' || v === 'lowbit';
/** MODEL_RUNTIME, or ?runtime= in the page URL. */
export function activeRuntime(): ModelRuntime {
  const wanted = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('runtime');
  return isModelRuntime(wanted) ? wanted : MODEL_RUNTIME;
}
/** How the model above decodes: its eval's sampling preset (vLLM semantics), which the patched runtime
 * applies on the GPU (vendor/lfm3-webgpu-pi/PATCHES.md), so the browser decodes the way the eval did.
 * Change it together with MODEL. SFT v0.7 (and the RL checkpoints): T 0.1, top_k 50, seed 42, repetition
 * penalty 1.1. SFT v0.6.1 L: the same with repetition_penalty 1 (it scored 6/12 with 1.1 against 8/12
 * without, docs/research/webgpu-repetition-penalty.md). */
export const MODEL_SAMPLING: SamplingPreset = MODEL_OPTION.sampling;
export interface SamplingPreset {
  /** 0 = greedy. */
  temperature: number; top_k?: number; top_p?: number; min_p?: number; seed?: number;
  repetition_penalty?: number; presence_penalty?: number; frequency_penalty?: number;
}
/** The prompt layout the model above was trained in (src/chart/prompt.ts): 'v0.2.2', the contract
 * in the question (SFT v0.6.1 and earlier), or 'v0.2.3.4', conventions and contract in the system
 * prompt and the bare question (SFT v0.7). Change it together with MODEL. ?layout= overrides it in
 * the dev server. */
export const MODEL_PROMPT_LAYOUT: PromptLayout = MODEL_OPTION.layout;
/** MODEL_PROMPT_LAYOUT, or ?layout=v0.2.2|v0.2.3.4 in the dev server only (measurement). */
export function activePromptLayout(): PromptLayout {
  const wanted = import.meta.env?.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('layout') : null;
  return isPromptLayout(wanted) ? wanted : MODEL_PROMPT_LAYOUT;
}

// Shown on the page next to the model. Facts about the weights MODEL points at.
export const MODEL_FACTS = {
  name: `LFM3 1.7B EHR agent (RL v3, ${MODEL_OPTION.bits})`,
  base: 'LiquidAI/LFM3-1.7B (LFM Open License)',
  training: 'Reinforcement learning (LoRA r32, step 200) on SFT v0.7-Lc, the supervised fine-tune of LFM3 1.7B to search and update FHIR records with one tool, fhir_request, and cite the records it used, in the Lc harness (compact search results)',
  quantization: MODEL_OPTION.quantization,
  result: MODEL_OPTION.id === 'q4'
    ? 'Lc held-out (strict): 60.2% BF16 on vLLM; Q4_K_M 58.6% vs 59.8% llama.cpp BF16, both at repetition penalty 1.1.'
    : `Lc held-out (strict): ${(100 * MODEL_OPTION.score).toFixed(1)}% at ${MODEL_OPTION.quant}, against 60.2% BF16 on vLLM.`,
}

export const CONTEXT_TOKENS = 16384;  // Pillar 6 budget: an L episode fits in 16K tokens

// The harness the model was trained in, which the Chart assistant must run it in:
//   'L'    the locked harness (fhir_request, results as JSON): SFT v0.6.1 and earlier;
//   'X16'  harness-suite profile X16 (Context-1 at 16,384 tokens: handles, prune, budget line,
//          overflow, dedup stubs, turn ramp): LFM3 SFT v0.6.1-X16. src/fhir/context1.ts.
//   'X16v2' X16 with exact token counts (LFM3's tokenizer), a hard cap on real prompt tokens and
//          pruning to 60%: the LFM3 RL checkpoint. src/fhir/context1_v2.ts.
//   'Lc'   L with compact search results (harness-suite profile Lc, at 7da3ad1): a successful
//          searchset Bundle is one line per record, values cut at 300 characters, and the system
//          prompt gains one harness section; everything else is L's JSON. The LoRA r32 step-200
//          checkpoint. src/fhir/compact_v2.ts.
// Switch to 'X16' together with MODEL when the v0.6.1-X16 GGUF is staged. ?harness=L|X16 in the
// page URL overrides it (for testing; L stays as the fallback). ?harness=X16v2 and ?harness=Lc likewise.
export type Harness = 'L' | 'X16' | 'X16v2' | 'Lc';
export const MODEL_HARNESS: Harness = MODEL_OPTION.harness;
const HARNESS_KEY = 'fhir-demo-harness';
export const isHarness = (v: unknown): v is Harness => v === 'X16' || v === 'X16v2' || v === 'L' || v === 'Lc';
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
