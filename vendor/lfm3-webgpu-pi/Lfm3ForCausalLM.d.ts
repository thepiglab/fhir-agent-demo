// Types for the parts of the vendored webml-community LFM3 WebGPU runtime this app calls.
// Written for fhir-env from the runtime's own code. The runtime is patched to sample on the GPU with the
// options below (see ./PATCHES.md).

export interface LoadProgress {
  status: 'init' | 'tokenizer' | 'weights' | 'ready' | string;
  message?: string;
  kind?: 'bytes' | 'tensors';
  loaded?: number;
  total?: number | null;
  fraction?: number;
}

export interface LoadOptions {
  maxLength?: number;
  onProgress?: (progress: LoadProgress) => void;
  /** Replaces fetch for every request the loader makes (HEAD, byte ranges). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** false: do not store the weights in the IndexedDB cache. */
  cache?: boolean;
  signal?: AbortSignal;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: Record<string, unknown> };
  errors?: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface Tool {
  type: 'function';
  function: { name: string; description?: string; parameters?: unknown };
}

export interface GenerateOptions {
  tools?: Tool[];
  enable_thinking?: boolean;
  max_new_tokens?: number;
  /** Stop tokens (default: the model's EOS ids). Up to 4 of them are also masked by min_tokens. */
  eos_token_id?: number | number[];
  /** Stop strings, checked on the decoded text. */
  stop_strings?: string[];
  // Sampling, on the GPU (vendor/lfm3-webgpu-pi/PATCHES.md), with vLLM's semantics and order:
  // logit_bias, min_tokens -> repetition, frequency, presence -> temperature -> min_p -> top_k -> top_p -> draw.
  // Passing temperature, top_k, top_p or min_p turns sampling on; temperature 0 or top_k 1 is greedy.
  /** 0 = greedy (argmax of the penalized logits). Default 1 once sampling is on. */
  temperature?: number;
  /** 1 to 64. Unset, 0 or -1: all 64 candidates (vLLM: the whole vocabulary; see PATCHES.md for the bound). */
  top_k?: number;
  /** (0, 1]. Default 1 (off). */
  top_p?: number;
  /** [0, 1], relative to the most likely token. Default 0 (off). */
  min_p?: number;
  /** Per-request seed: the same seed gives the same tokens. Default: random. */
  seed?: number;
  /** Multiplicative, over prompt and output tokens: a seen token's logit is divided by it when positive, multiplied when not. 1 = off. */
  repetition_penalty?: number;
  /** [-2, 2]. Subtracted once from every token already in this reply. 0 = off. */
  presence_penalty?: number;
  /** [-2, 2]. Subtracted per occurrence in this reply. 0 = off. */
  frequency_penalty?: number;
  /** Token id -> bias added to its logit (clamped to [-100, 100]). */
  logit_bias?: Record<number, number>;
  /** The stop tokens (eos_token_id) cannot be generated before this many new tokens. */
  min_tokens?: number;
  signal?: AbortSignal;
}

export type TurnEvent =
  | { type: 'prefill'; done: number; total: number }
  | { type: 'reasoning' | 'text'; text: string }
  | { type: 'tool_call'; tool_call: ToolCall };

export interface TurnResult {
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'cancelled';
  message: ChatMessage & { role: 'assistant' };
  usage: { prompt_tokens: number; cached_tokens?: number; image_tokens?: number; completion_tokens: number; reasoning_tokens?: number };
  timings?: { ttft_ms: number; decode_ms: number; tokens_per_second: number };
}

export interface ChatTurn extends AsyncIterable<TurnEvent> {
  readonly result: Promise<TurnResult>;
  cancel(): void;
}

export interface ChatSession {
  generate(messages: ChatMessage[], options?: GenerateOptions): ChatTurn;
  get_seq_length(): number;
  readonly max_length: number;
  reset(): void;
  dispose(): Promise<void>;
}

export class Lfm3ForCausalLM {
  static from_pretrained(source: string, options?: LoadOptions): Promise<Lfm3ForCausalLM>;
  create_session(options?: { max_checkpoints?: number }): ChatSession;
  deviceInfo(): unknown;
  dispose(): Promise<void>;
}

export class BusyError extends Error {}
export class ContextOverflowError extends Error {}
export class DeviceLostError extends Error {}
export default Lfm3ForCausalLM;
