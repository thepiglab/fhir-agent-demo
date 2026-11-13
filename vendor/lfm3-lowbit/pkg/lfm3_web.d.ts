/* tslint:disable */
/* eslint-disable */

export class Engine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    adapter(): string;
    decode(ids: Uint32Array | number[], skip_special: boolean): string;
    /**
     * Tokenize text (special tokens parsed, no BOS added: the template writes it).
     */
    encode(text: string): Uint32Array;
    /**
     * Generate after `prompt` (the whole conversation; its common prefix with the previous call is reused).
     * `on_tokens(Uint32Array) -> bool` after every chunk of `chunk` tokens (false cancels). Resolves to
     * `{tokens: Uint32Array, finish: "stop"|"length"|"cancelled", prompt_tokens, cached_tokens, prefill_ms, decode_ms}`.
     */
    generate(prompt: Uint32Array | number[], params_json: string, max_new: number, chunk: number, on_tokens: Function): Promise<any>;
    /**
     * Stream the GGUF through `fetch_range(offset, len) -> Promise<Uint8Array>` onto the GPU.
     * `on_progress(done_bytes, total_bytes)` is called after every tensor.
     */
    static load(fetch_range: Function, file_len: number, max_ctx: number, on_progress: Function): Promise<Engine>;
    max_ctx(): number;
    /**
     * a GGUF metadata value as JSON-ish text (e.g. "tokenizer.chat_template")
     */
    meta_str(key: string): string | undefined;
    /**
     * A streaming splitter for one reply. `in_think`: the prompt ended with `<think>`. `stop_ids` are not decoded.
     */
    new_stream(in_think: boolean, tools_json: string | null | undefined, stop_ids: Uint32Array | number[]): TextStream;
    /**
     * Parse a whole reply into {reasoning, content, tool_calls: [{name, arguments, errors?}], errors} (JSON).
     */
    parse_reply(text: string, tools_json?: string | null): string;
    /**
     * Render the GGUF's chat template (messages and tools as JSON text), with the generation prompt.
     */
    render_chat(messages_json: string, tools_json: string | null | undefined, enable_thinking: boolean): string;
    /**
     * Start a new sequence (drop the KV prefix).
     */
    reset(): void;
    seq_len(): number;
    token_id(token: string): number | undefined;
    /**
     * bytes allocated on the GPU (weights + KV cache + activations)
     */
    vram_bytes(): number;
}

/**
 * Streamed assistant text: token ids in, routed reasoning / text deltas out (JSON).
 */
export class TextStream {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    finish(): string;
    /**
     * everything generated so far, as text (markup included)
     */
    full_text(): string;
    /**
     * feed generated ids; returns a JSON array of {type: "reasoning"|"text", text}
     */
    push(ids: Uint32Array | number[]): string;
    reasoning_tokens(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly __wbg_textstream_free: (a: number, b: number) => void;
    readonly engine_adapter: (a: number) => [number, number];
    readonly engine_decode: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_encode: (a: number, b: number, c: number) => [number, number];
    readonly engine_generate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any) => any;
    readonly engine_load: (a: any, b: number, c: number, d: any) => any;
    readonly engine_max_ctx: (a: number) => number;
    readonly engine_meta_str: (a: number, b: number, c: number) => [number, number];
    readonly engine_new_stream: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly engine_parse_reply: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly engine_render_chat: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly engine_reset: (a: number) => void;
    readonly engine_seq_len: (a: number) => number;
    readonly engine_token_id: (a: number, b: number, c: number) => number;
    readonly engine_vram_bytes: (a: number) => number;
    readonly textstream_finish: (a: number) => [number, number];
    readonly textstream_full_text: (a: number) => [number, number];
    readonly textstream_push: (a: number, b: number, c: number) => [number, number];
    readonly textstream_reasoning_tokens: (a: number) => number;
    readonly wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___js_sys_adfa250c9de6b6cd___Function_fn_wasm_bindgen_2514664e3b2c9a7c___JsValue_____wasm_bindgen_2514664e3b2c9a7c___sys__Undefined___js_sys_adfa250c9de6b6cd___Function_fn_wasm_bindgen_2514664e3b2c9a7c___JsValue_____wasm_bindgen_2514664e3b2c9a7c___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___wasm_bindgen_2514664e3b2c9a7c___JsValue__core_d941ad8722425d2e___result__Result_____wasm_bindgen_2514664e3b2c9a7c___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___wasm_bindgen_2514664e3b2c9a7c___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
