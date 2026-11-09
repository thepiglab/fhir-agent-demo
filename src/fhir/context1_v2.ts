// Port of fhir_suite_harness/profiles/context1_v2.py at 2e88963 (sha256 5193b744fe6af9d70268932ea87db374e87f3cfc3f68429ad95792e80f76b850)
// with its registration in fhir_suite_harness/profiles/__init__.py at 2e88963 (sha256 e6507ceb065508800ce5da37344c24a5b4be8a5edea2c5375ec72378c67c5553).
//
// Harness X16v2: X16 (context1.ts) with exact budget accounting, the harness LFM3's RL checkpoint
// trains in. Only the accounting differs from X16:
//  - the text added since the last call is counted with LFM3's tokenizer (tokenizer.ts: what
//    tokenizers.Tokenizer.encode gives, plus 8 tokens per message), anchored to that call's real
//    usage; without a tokenizer, a conservative 2.5 characters per token;
//  - a call whose real prompt exceeds the budget ends the episode as a failure (the browser could
//    not run it);
//  - the overflow pass prunes down to 60% of the budget (X16: 70%).
import { Context1Profile } from './context1.ts';
import type { Context1Options, Episode, ModelReply } from './context1.ts';
import type { Rec } from './pyrt.ts';
import type { Lfm3Tokenizer } from './tokenizer.ts';
import { pyDumps } from './pyjson.ts';

export const MESSAGE_TOKENS = 8;  // chat-template tokens around each message
export const X16V2_OPTIONS: Context1Options = { budget: 16_384, soft: 0.60, hard: 0.85, target: 0.60, ramp_from: 15, chars_per_token: 2.5 };

export class HardCapExceeded extends Error {}

/** context1_v2.message_text. */
export function messageText(message: Rec): string {
  const parts: string[] = [];
  const content = message.content;
  parts.push(typeof content === 'string' ? content : pyDumps(content || ''));
  for (const key of ['reasoning_content', 'reasoning']) if (typeof message[key] === 'string') parts.push(message[key] as string);
  for (const call of (message.tool_calls as Rec[] | undefined) ?? []) {
    const fn = (call.function as Rec | undefined) ?? {};
    parts.push(String(fn.name || '') + String(fn.arguments || ''));
  }
  return parts.join('\n');
}

export class Context1V2Profile extends Context1Profile {
  override name = 'X16v2';
  readonly tokenizer: Lfm3Tokenizer | null;
  private ep: Episode | null = null;

  constructor(fhirTool: unknown, tokenizer: Lfm3Tokenizer | null, options: Partial<Context1Options> = {}) {
    super(fhirTool, { ...X16V2_OPTIONS, ...options });
    this.tokenizer = tokenizer;
  }

  count(messages: Rec[]): number {
    if (!this.tokenizer) return Math.ceil(Context1Profile.chars(messages) / this.options.chars_per_token);
    let total = 0;
    for (const m of messages) total += this.tokenizer.count(messageText(m)) + MESSAGE_TOKENS;
    return total;
  }

  override estimate(): number {
    const [messages] = this.render();
    const now = this.count(messages);
    if (this.calibration) {
      const [tokens, base] = this.calibration;
      return Math.max(0, tokens + now - base);
    }
    return now + Math.ceil(this.toolsChars / this.options.chars_per_token);
  }

  override calibrate(messages: Rec[], reply: ModelReply): void {
    const usage = reply.usage ?? {};
    const prompt = Math.trunc(Number(usage.prompt_tokens || 0));
    if (prompt > this.options.budget) {
      const ep = this.ep!;
      ep.metrics.set('hard_cap_exceeded', 1);
      ep.metrics.set('hard_cap_prompt_tokens', prompt);
      ep.log('hard_cap', { prompt_tokens: prompt, budget: this.options.budget });
      throw new HardCapExceeded(String(prompt));
    }
    const tokens = prompt + Math.trunc(Number(usage.completion_tokens || 0));
    this.calibration = tokens > 0 ? [tokens, this.count([...messages, reply.message])] : null;
  }

  override async run(ep: Episode, system: string, prompt: string, hooks: Parameters<Context1Profile['run']>[3] = {}): Promise<string> {
    this.ep = ep;
    try {
      return await super.run(ep, system, prompt, hooks);
    } catch (e) {
      if (e instanceof HardCapExceeded) return '';  // the browser cannot run a prompt past its context
      throw e;
    }
  }
}
