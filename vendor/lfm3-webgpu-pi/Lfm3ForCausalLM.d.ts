// Types for the parts of the vendored webml-community LFM3 WebGPU runtime this app calls.
// Written for fhir-env from the runtime's own code. The runtime itself is patched in one respect:
// `repetition_penalty` (see ./PATCHES.md).

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
  temperature?: number;
  /** 1 to 64. */
  top_k?: number;
  top_p?: number;
  min_p?: number;
  seed?: number;
  /**
   * Repetition penalty with Hugging Face / vLLM / llama.cpp semantics, applied to every token in the
   * prompt and in the reply so far: a seen token's logit is divided by the penalty when positive and
   * multiplied by it when not. 1 (the default) is off. Works in the greedy decode path, on models
   * whose lm_head is the single-stage q6_k head (our Q4_K_M GGUFs); other heads throw.
   */
  repetition_penalty?: number;
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
