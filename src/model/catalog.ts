// The models a visitor can choose (the model picker): one RL v3 checkpoint, quantized four ways.
// Each option is a complete model setting: the file and its pin, the runtime that runs it, and the harness,
// prompt layout and sampling it was evaluated with. config.ts takes MODEL, MODEL_FILE, MODEL_RUNTIME and the
// rest from the chosen option. Each file has its own URL, so it gets its own entry in the weights cache and
// can be removed on its own; a newer version of the same quantization replaces an older one (model.ts,
// replacedBy).
//
// Quality is Lc held-out (strict), on the same questions for all four (full precision, BF16 on vLLM: 60.2%).
// Memory is GPU memory while the model runs at the demo's 16,384-token context. Each figure says how it was
// measured; they are measured numbers, not estimates.
//
// HF_COMMIT_V3 is a placeholder for the Hugging Face commit of the v3 upload, which holds all four files
// (staged on HPG in /blue/cai5731/wkieffer/fhir/demo/release-v0235-r32-s200-v3/, SHA256SUMS-all). All four
// names carry "-v3-", so the version check sees one version; the picker chooses by file. An option
// whose pin is still a placeholder is shown as "not uploaded yet" and cannot be chosen, except in the dev
// server (where ?model= or a local models/ copy can stand in).
import type { PromptLayout } from '../chart/prompt.ts';
import type { Harness, ModelRuntime, SamplingPreset } from './config.ts';

export type ModelOptionId = 'q4' | 'q3' | 'q2' | 'ternary';

export interface ModelOption {
  id: ModelOptionId;
  /** "4-bit": what the picker leads with. */
  bits: string;
  /** The GGUF quantization, e.g. "Q4_K_M". */
  quant: string;
  /** "owner/repo@commit/file.gguf" (see config.ts, MODEL). */
  spec: string;
  /** The file as Hugging Face will report it (X-Linked-ETag, X-Linked-Size). */
  file: { sha256: string; bytes: number };
  runtime: ModelRuntime;
  harness: Harness;
  layout: PromptLayout;
  sampling: SamplingPreset;
  /** Lc held-out strict accuracy, 0 to 1. */
  score: number;
  /** One line on quality, for the picker. */
  quality: string;
  /** GPU memory to run it, and how that was measured. */
  memory: { bytes: number; how: string };
  /** Below the demo's quality bar: shown, but labelled experimental. */
  experimental?: boolean;
  /** Facts shown next to the model (overrides of config.ts's MODEL_FACTS). */
  quantization: string;
}

const HF = 'mkieffer/LFM3-FHIR-demo-v1';
/** Full precision (BF16 on vLLM), the bar every option is compared with. */
export const BF16_SCORE = 0.602;
const SAMPLING: SamplingPreset = { temperature: 0.1, top_k: 50, seed: 42, repetition_penalty: 1.1 };
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

const B200 = 'GPU memory over idle in headless Chrome 157 (WebGPU) on an NVIDIA B200, after loading and running a turn, lowbit runtime';

export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: 'q4', bits: '4-bit', quant: 'Q4_K_M',
    spec: `${HF}@HF_COMMIT_V3/LFM3-FHIR-demo-v3-Q4_K_M.gguf`,
    file: { sha256: 'fc480a24f50fa2e6d14de1b8ad96c58f1baa3acb93e4a14d6ab6ccedd2a31297', bytes: 1_099_627_360 },
    runtime: 'vendored', harness: 'Lc', layout: 'v0.2.3.4', sampling: SAMPLING,
    score: 0.586, quality: `${pct(0.586)} on held-out questions (full precision: ${pct(BF16_SCORE)})`,
    memory: { bytes: 1_714_000_000, how: 'Peak WebGPU buffer bytes (1,714 MB; 1,570 MB after load) in Chrome on an Apple M1 Max, vendored runtime, the same-size SFT v0.7 Q4_K_M at the bench page\'s context' },
    quantization: 'llama.cpp Q4_K_M (stock tensor layout, which the vendored WebGPU runtime requires), decoded with repetition penalty 1.1',
  },
  {
    id: 'q3', bits: '3-bit', quant: 'Q3_K',
    spec: `${HF}@HF_COMMIT_V3/LFM3-FHIR-demo-v3-3bit-Q3_K-QAD.gguf`,
    file: { sha256: '35de540ae3c0746e73effdec9c9ff4e1244b5b4dc6275d729b25b6395771e2ec', bytes: 881_761_120 },
    runtime: 'lowbit', harness: 'Lc', layout: 'v0.2.3.4', sampling: SAMPLING,
    // Lc 0.596 and 0.593 were measured on the non-e4 Q3_K-m4-fd4 / Q2_K-m4-fd3 siblings (949 / 823 MB); the
    // e4 files' own evals replace them when done (Q2_K e4: job 51186131).
    score: 0.596, quality: `${pct(0.596)} on held-out questions (full precision: ${pct(BF16_SCORE)})`,
    memory: { bytes: 1_430_000_000, how: B200 },
    quantization: 'Q3_K mix (Q3_K-m4-fd4, e4 embedding), trained with quantization-aware distillation; runs on the lowbit WebGPU runtime with the weights packed in GPU memory',
  },
  {
    id: 'q2', bits: '2-bit', quant: 'Q2_K',
    spec: `${HF}@HF_COMMIT_V3/LFM3-FHIR-demo-v3-2bit-Q2_K-QAD.gguf`,
    file: { sha256: '2e202365c52e52a70f401771dcabb1cfd2dc242641302334cb85cc81a618cdf5', bytes: 754_948_960 },
    runtime: 'lowbit', harness: 'Lc', layout: 'v0.2.3.4', sampling: SAMPLING,
    score: 0.593, quality: `${pct(0.593)} on held-out questions (full precision: ${pct(BF16_SCORE)})`,
    memory: { bytes: 1_300_000_000, how: `${B200}. On an Apple M1 Max the engine's GPU buffers were 1.03 GB` },
    quantization: 'Q2_K mix (Q2_K-m4-fd3, e4 embedding), trained with quantization-aware distillation; runs on the lowbit WebGPU runtime with the weights packed in GPU memory',
  },
  {
    id: 'ternary', bits: 'Ternary', quant: 'Q2_0',
    spec: `${HF}@HF_COMMIT_V3/LFM3-FHIR-demo-v3-ternary-Q2_0-QAD.gguf`,
    file: { sha256: '961eb8cf1a5d7227e8521b7b3822e724eabe05dc9042fa8d2527ed0e9a380e8a', bytes: 634_329_952 },
    runtime: 'lowbit', harness: 'Lc', layout: 'v0.2.3.4', sampling: SAMPLING,
    score: 0.534, quality: `Experimental, the smallest: ${pct(0.534)} on held-out questions, below the demo's quality bar`,
    memory: { bytes: 1_170_000_000, how: B200 },
    experimental: true,
    quantization: 'Ternary Q2_0 (Q2_0 e4), trained with quantization-aware distillation; runs on the lowbit WebGPU runtime with the weights packed in GPU memory',
  },
];

/**
 * The option a first visit gets. 4-bit until the 2-bit file is on Hugging Face: Q2_K keeps quality
 * (59.3% vs 58.6%) at three-quarters of the download and less GPU memory, so it should become the default
 * once uploaded and checked in a real browser.
 */
export const DEFAULT_MODEL_ID: ModelOptionId = 'q4';

export const isModelOptionId = (v: unknown): v is ModelOptionId => MODEL_OPTIONS.some((o) => o.id === v);
export const modelOption = (id: ModelOptionId): ModelOption => MODEL_OPTIONS.find((o) => o.id === id)!;
/** The file is on Hugging Face (its pin is a real commit, not a placeholder). */
export const uploaded = (o: ModelOption): boolean => !/@HF_COMMIT_/.test(o.spec);
/** Choosable here: uploaded, or any option in the dev server. */
export const choosable = (o: ModelOption): boolean => uploaded(o) || !!import.meta.env?.DEV;

const CHOICE_KEY = 'fhir-demo-model';
/** The visitor's saved choice (the picker), or null. */
export function chosenModelId(): ModelOptionId | null {
  try { const v = JSON.parse(globalThis.localStorage?.getItem(CHOICE_KEY) ?? 'null'); return isModelOptionId(v) ? v : null; } catch { return null; }
}
export function setChosenModelId(id: ModelOptionId | null): void {
  try { if (id) globalThis.localStorage?.setItem(CHOICE_KEY, JSON.stringify(id)); else globalThis.localStorage?.removeItem(CHOICE_KEY); } catch { /* storage unavailable */ }
}
/** The option this page runs: ?quant=q4|q3|q2|ternary, else the saved choice, else the default. */
export function selectedOption(): ModelOption {
  const wanted = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('quant');
  const id = [wanted, chosenModelId()].find((v): v is ModelOptionId => isModelOptionId(v) && choosable(modelOption(v)));
  return modelOption(id ?? DEFAULT_MODEL_ID);
}

