// LFM3 chat template (the fine-tune's chat_template.jinja, as rendered for this agent) and
// tool-call parsing. The episode is append-only text: the model's raw output stays in the
// context, which is how GRPO v0.5 trained (thinking on, turns merged into one sample).
// tests/test_browser_chat.py checks these strings against the Jinja template.
import { pyDumps } from '../fhir/fhir_store.ts';

export const BOS = '<|startoftext|>';
export const IM_END = '<|im_end|>';

/** An OpenAI-style function schema; extra keys are rendered as they are. */
export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: { properties?: Record<string, { type?: unknown; [key: string]: unknown }>; [key: string]: unknown };
  [key: string]: unknown;
}
/** A tool as {type, function} or as the bare function schema. */
export type ChatTool = { function: ToolFunction; [key: string]: unknown } | ToolFunction;

/** One parsed <tool_call>: arguments typed by the tool schema, errors for bad JSON. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  errors: string[];
  raw: string;
}

export interface ParsedTurn {
  reasoning: string;
  content: string;
  calls: ToolCall[];
  /** True when "<tool_call>" appears but no call parsed. */
  unparsed: boolean;
}

export type FinalResult =
  | { ok: true; answer: unknown; evidence: unknown }
  | { ok: false; error: string };

// tool.function ?? tool, as the template does.
const toolFunction = (tool: ChatTool): ToolFunction =>
  ((tool as { function?: ToolFunction }).function ?? tool) as ToolFunction;

function toolToJson(tool: ChatTool): string {
  const fn = toolFunction(tool);
  return '{' + Object.entries(fn).filter(([k]) => k !== 'defer_loading')
    .map(([k, v]) => pyDumps(k) + ': ' + pyDumps(v)).join(', ') + '}';
}

// System + tools + one user message, ending in the generation prompt.
export function renderPrompt(systemPrompt: string, tools: ChatTool[], user: string, { thinking = true }: { thinking?: boolean } = {}): string {
  let system = systemPrompt;
  if (tools.length) system += (system ? '\n\n' : '') + '<tools>\n' + tools.map(toolToJson).join('\n') + '\n</tools>';
  return BOS + '<|im_start|>system\n' + system + IM_END + '\n'
    + '<|im_start|>user\n' + user + IM_END + '\n'
    + generationPrompt(thinking);
}

export function generationPrompt(thinking = true): string {
  return '<|im_start|>assistant\n' + (thinking ? '<think>' : '<think></think>');
}

// Text appended after the model's turn (which ended in <|im_end|>, already in the cache):
// the tool results, then the next generation prompt. Several calls in one turn become
// consecutive tool messages, as the template renders them without a shared tool_call_id.
export function renderToolResults(outputs: string[], { thinking = true }: { thinking?: boolean } = {}): string {
  return '\n' + outputs.map((o) => '<|im_start|>tool\n<tool_response>\n' + o + '\n</tool_response>' + IM_END + '\n').join('')
    + generationPrompt(thinking);
}

const CALL = /<tool_call>\s*<function=([^\n>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
const PARAM = /<parameter=([^>\n]+)>\n?([\s\S]*?)\n?<\/parameter>(?=\s*(?:<parameter=|$))/g;

// Split one assistant turn (text generated after "<think>") into reasoning, content and
// tool calls. Argument values are typed by the tool schema, as vLLM's qwen3_coder parser
// does: strings stay raw, objects and numbers are parsed as JSON.
export function parseTurn(text: string, tools: ChatTool[] = []): ParsedTurn {
  text = text.replace(/<\|im_end\|>\s*$/, '');
  let reasoning = '', rest = text;
  const close = text.indexOf('</think>');
  if (close >= 0) { reasoning = text.slice(0, close).trim(); rest = text.slice(close + 8); }
  const types: Record<string, Record<string, unknown>> = {};
  for (const t of tools) {
    const fn = toolFunction(t);
    types[fn.name] = Object.fromEntries(Object.entries(fn.parameters?.properties ?? {}).map(([k, v]) => [k, v.type]));
  }
  const calls: ToolCall[] = [];
  for (const m of rest.matchAll(CALL)) {
    const name = m[1].trim(), args: Record<string, unknown> = {}, errors: string[] = [];
    for (const p of m[2].trim().matchAll(PARAM)) {
      const key = p[1].trim(), raw = p[2];
      const type = types[name]?.[key] ?? 'string';
      if (type === 'string') args[key] = raw;
      else {
        try { args[key] = JSON.parse(raw); } catch { errors.push(`${key} is not valid JSON`); args[key] = raw; }
      }
    }
    calls.push({ name, args, errors, raw: m[0] });
  }
  const content = rest.replace(CALL, '').trim();
  return { reasoning, content, calls, unparsed: !calls.length && /<tool_call>/.test(rest) };
}

// The final answer contract: exactly one JSON object with keys answer and evidence.
export function parseFinal(content: string): FinalResult {
  try {
    const obj: unknown = JSON.parse(content);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const keys = Object.keys(obj).sort().join(',');
      if (keys === 'answer,evidence') return { ok: true, answer: (obj as Record<string, unknown>).answer, evidence: (obj as Record<string, unknown>).evidence };
    }
    return { ok: false, error: 'JSON is not {answer, evidence}' };
  } catch (e) {
    return { ok: false, error: 'not JSON: ' + (e as Error).message };
  }
}
