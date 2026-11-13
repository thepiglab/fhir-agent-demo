// Types for lfm3.js, the low-bit runtime: the same API as the vendored Lfm3ForCausalLM for what the demo uses,
// so the session, turn, message and option types are the vendored runtime's own.
import type { ChatSession, LoadOptions } from '../lfm3-webgpu-pi/Lfm3ForCausalLM.js';

export class BusyError extends Error {}
export class ContextOverflowError extends Error {}
export class DeviceLostError extends Error {}

export class Lfm3ForCausalLM {
  /** `wasmUrl` overrides where the engine's .wasm is fetched from (default: next to pkg/lfm3_web.js). */
  static from_pretrained(source: string, options?: LoadOptions & { wasmUrl?: string | URL }): Promise<Lfm3ForCausalLM>;
  create_session(): ChatSession;
  deviceInfo(): { adapter: unknown; vram_bytes: number; runtime: 'lfm3-lowbit'; load_ms: number; file_bytes: number | null };
  dispose(): Promise<void>;
}
export default Lfm3ForCausalLM;
