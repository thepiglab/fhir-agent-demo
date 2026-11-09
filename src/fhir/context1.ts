// Port of fhir_suite_harness/profiles/context1.py at 647729c (sha256 4f7288bfd51a85d0993ea5c5d0bb575520861c19531fd17380368d8cf8c39933)
// and of the Episode parts it uses from fhir_suite_harness/core.py at 647729c (sha256 1e615cac13dae6cf4743d2b6443f730434c0a5388516d0657abcf5944465162a);
// profile options from fhir_suite_harness/profiles/__init__.py at 647729c (sha256 fe9a6854ab60d60b4d1dc6ab58e6f33b8a5ec1632c92b63ef440079c463279f8).
//
// Harness X16: Chroma Context-1's self-editing context at the browser's 16,384-token budget,
// the harness LFM3 SFT v0.6.1-X16 was trained and evaluated in. Tools: fhir_request (the locked
// schema, results as L's JSON text) and prune(refs, results). Each tool result starts with a
// handle ([r3]); the message list is rebuilt from the full log every turn; after each turn the
// last tool result ends with [Token usage: N/B | turn t/20]; a nudge at 60%, only prune past 85%,
// the harness prunes the oldest results itself (with a note under the task) when the next call
// would exceed the budget; a record already shown in full appears in later search results as
// "Type/id (already shown above)"; a soft turn ramp. Exposure is deferred: a record counts as
// read once a model call that showed it in full has returned.
//
// Byte-for-byte with Python: every message list sent to the model, the budget line (character
// counts are code points, as Python's len), the handles, stubs and notes, the metrics and
// events, and the store exposure the scorer reads. tests/parity/x16.test.ts replays the golden
// corpus (scripts/web_demo/make_x16_corpus.py) to check it.

import { pyDumps } from './pyjson.ts';
import { loadsStrict } from './protocol.ts';
import { pyLen, pyHead, pyStr, pyStrip, isDict } from './pyrt.ts';
import type { Rec } from './pyrt.ts';
import { ref } from './validation.ts';
import type { FhirResult, FhirStore, Headers } from './store.ts';
import { ExposureTracker } from './exposure.ts';
import { ArgumentError, TOOL_ERROR, UNKNOWN_TOOL, parseArguments, validateFhirRequest } from './tools.ts';

// ------------------------------------------------------------------ texts (verbatim)
const INTERFACE = (budget: string, cap: number, soft: number, hard: number): string =>
  `Context budget. Your context has a budget of ${budget} tokens and you have ${cap} turns. After each turn the last tool result ends with a line such as [Token usage: 14,203/${budget} | turn 3/${cap}]: the estimated size of your context and the turn about to start.
Each tool result starts with a handle such as [r3]. prune(refs, results) removes content you no longer need from your view: refs are Type/id records to remove from every earlier tool result, results are handles of whole results to remove. Pruned content becomes a one-line stub; pruned records still count as read and can still be cited.
A record already shown in full in an earlier result appears in later search results as "Type/id (already shown above)".
Past ${soft}% of the budget, prune results you no longer need, or answer. Past ${hard}% only prune is accepted. If the context would exceed the budget, the harness prunes the oldest results itself and says so.`;
const TOKEN_LINE = (n: number, budget: number, turn: number, cap: number) => `[Token usage: ${grouped(n)}/${grouped(budget)} | turn ${turn}/${cap}]`;
const NUDGE = (pct: number) => `Past ${pct}% of the budget: prune results you no longer need, or answer.`;
const HARD_NOTE = (pct: number) => `Past ${pct}% of the budget: only prune is accepted. Prune results you no longer need, or answer.`;
const RAMP = (left: number) => `${left} turns left: finish soon.`;
const LAST_TURN = 'Last turn: answer now.';
const OVERFLOW_LINE = (handles: string) => `The harness pruned ${handles} to stay within the budget (see the note under the task).`;
const HARD_ERROR = (n: number, budget: number, pct: number) =>
  `error: the context is at ${grouped(n)}/${grouped(budget)} tokens, past the ${pct}% hard limit; only `
  + 'prune is accepted. Prune results you no longer need, or answer.';
const PINNED = (budget: number, handles: string) =>
  `[Harness note: the context would have exceeded the ${grouped(budget)}-token budget, so the `
  + `harness pruned results ${handles} (oldest first). Pruned records still count as read `
  + 'and can be cited; repeat a request if you need its data again.]';
const DUPLICATE = (r: string) => `${r} (already shown above)`;
const PRUNED_RECORD = (r: string) => `[pruned: ${r}]`;
const PRUNED_RESULT = (handle: string, label: string) => `[pruned: ${handle} ${label}]`;
const PRUNE_USAGE = 'error: prune takes refs, a list of Type/id strings, and results, a list of result handles such as r3';
const MESSAGE_OVERHEAD = 16;
const LABEL_CHARS = 160;

/** Python's f"{n:,}" for an int. */
function grouped(n: number): string {
  const s = String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? '-' + s : s;
}
/** Python's round() on these option products (60.0, 85.00000000000001, ...): round half to even. */
function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export const PRUNE_TOOL = {
  type: 'function',
  function: {
    name: 'prune',
    description: 'Remove content you no longer need from your view to free context budget. '
      + 'Pruned content becomes a one-line stub; pruned records still count as read '
      + 'and can still be cited.',
    parameters: {
      type: 'object',
      properties: {
        refs: {
          type: 'array', items: { type: 'string' }, default: [],
          description: 'Type/id records to remove from every earlier tool result, e.g. Observation/abc',
        },
        results: {
          type: 'array', items: { type: 'string' }, default: [],
          description: 'Handles of whole earlier tool results to remove, e.g. r3',
        },
      },
    },
  },
} as const;

// ------------------------------------------------------------------ the episode (core.Episode)
export interface ToolCallIn { id: string; name: string; arguments: string }
/** One model reply: the assistant message as the harness keeps it (an OpenAI message's
 * model_dump(exclude_none=True)), its tool calls, and the call's token usage. */
export interface ModelReply {
  content: string;
  tool_calls: ToolCallIn[];
  message: Rec;
  finish_reason?: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}
export type Chat = (messages: Rec[], tools: unknown[]) => Promise<ModelReply>;

export class TurnLimit extends Error {}

/** Python's collections.Counter of numbers, keeping insertion order. */
export class Counter extends Map<string, number> {
  add(key: string, n = 1): void { this.set(key, (this.get(key) ?? 0) + n); }
  at(key: string): number { return this.get(key) ?? 0; }
}

/** Resources a request returned, as FhirStore.request counts them. */
function returnedResources(result: FhirResult): Rec[] {
  if ((result.status ?? 500) >= 300 || !result.body || !Object.keys(result.body).length) return [];
  const body = result.body;
  if (body.resourceType === 'Bundle') {
    return ((body.entry as Rec[] | undefined) ?? []).filter((e) => Object.hasOwn(e, 'resource')).map((e) => e.resource as Rec);
  }
  if (body.id) return [body];
  return [];
}

/** The parts of fhir_suite_harness.core.Episode a deferred-exposure profile uses. */
export class Episode {
  store: FhirStore;
  max_root_turns: number;
  deferred_exposure: boolean;
  root_turn = 0;
  metrics = new Counter();
  events: Rec[] = [];
  exposure: ExposureTracker;
  last_root_content = '';
  private chat: Chat;

  constructor(store: FhirStore, chat: Chat, { max_root_turns = 20, deferred_exposure = true } = {}) {
    this.store = store;
    this.chat = chat;
    this.max_root_turns = max_root_turns;
    this.deferred_exposure = deferred_exposure;
    this.exposure = new ExposureTracker(store);
  }

  async model(messages: Rec[], tools: unknown[]): Promise<ModelReply> {
    if (this.root_turn >= this.max_root_turns) throw new TurnLimit(`${this.max_root_turns} root turns`);
    this.root_turn += 1;
    const reply = await this.chat(messages, tools);
    this.last_root_content = reply.content;
    if (reply.finish_reason === 'length') this.metrics.add('length_truncations');
    return reply;
  }

  request(method: string, path: string, body: Rec | null, if_match: string, if_none_exist: string, tool = 'fhir_request'): FhirResult {
    const headers: Headers = {};
    if (if_match) headers['If-Match'] = if_match;
    if (if_none_exist) headers['If-None-Exist'] = if_none_exist;
    const store = this.store;
    store.active_tool = tool;
    store.agent_tools.push(tool);
    store.round = this.root_turn;
    const visible = this.deferred_exposure ? [] : null;
    const result = store.request(method, path, body, headers, visible);
    const eventIndex = store.events.length - 1;
    const returned = returnedResources(result);
    this.exposure.register(eventIndex, returned);
    if (this.deferred_exposure) {
      const exposed: Record<string, string[]> = {};
      for (const r of returned) exposed[ref(r)] = [];
      (store.events.at(eventIndex) as unknown as { exposed_fields: Record<string, string[]> }).exposed_fields = exposed;
    }
    return result;
  }

  exposeFields(key: string, fields: Iterable<string>, channel = 'render') {
    return this.exposure.exposeFields(key, fields, channel, this.root_turn);
  }

  exposeText(text: string, channel = 'stdout') {
    if (text) this.store.observe_response_terms(text);
    return this.exposure.exposeText(text, channel, this.root_turn);
  }

  log(kind: string, data: Rec): void { this.events.push({ turn: this.root_turn, kind, ...data }); }
}

/** core.execute_fhir_request: [tool message text, result or null when the call never reached the store]. */
function executeFhirRequest(ep: Episode, raw: string): [string, FhirResult | null] {
  const [parsed, error] = parseArguments(raw);
  if (error !== null || parsed === null) {
    ep.metrics.add('invalid_tool_calls');
    return [error ?? '', null];
  }
  let args;
  try {
    args = validateFhirRequest(parsed);
  } catch (e) {
    if (!(e instanceof ArgumentError)) throw e;
    ep.metrics.add('invalid_tool_calls');
    return [e.message, null];
  }
  let result: FhirResult;
  try {
    result = ep.request(args.method, args.path, Object.keys(args.body).length ? args.body as Rec : null, args.if_match, args.if_none_exist);
  } catch (e) {
    ep.metrics.add('invalid_tool_calls');
    return [TOOL_ERROR('fhir_request', e instanceof Error ? e.message : String(e)), null];
  }
  return [pyDumps(result), result];
}

// ------------------------------------------------------------------ the profile
interface Slot { ref: string; record: Rec; key: string; searchset: boolean }
interface Result {
  index: number; handle: string; call_id: string; label: string;
  text: string; result: FhirResult | null; slots: Slot[];
  pruned: '' | 'model' | 'harness'; annotation: string; shown: boolean; cache: Map<string, string>;
}

const isRecord = (v: unknown): v is Rec => isDict(v) && !!v.resourceType && !!v.id;

/** json.dumps(value, sort_keys=True, ensure_ascii=False): equal for the same content. */
function canonical(value: unknown): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (isDict(v)) {
      const out: Rec = {};
      for (const k of Object.keys(v).sort(codePointOrder)) out[k] = sortDeep(v[k]);
      return out;
    }
    return v;
  };
  return pyDumps(sortDeep(value));
}
function codePointOrder(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

function recordSlots(result: FhirResult): Slot[] {
  const body = result.body;
  if ((result.status ?? 500) >= 300 || !isDict(body) || !Object.keys(body).length) return [];
  let searchset: boolean, records: Rec[];
  if (body.resourceType === 'Bundle') {
    searchset = body.type === 'searchset';
    records = ((body.entry as Rec[] | undefined) ?? []).map((e) => e.resource).filter(isRecord);
  } else if (isRecord(body)) {
    searchset = false; records = [body];
  } else return [];
  return records.map((r) => ({ ref: ref(r), record: r, key: canonical(r), searchset }));
}

function renderPayload(result: FhirResult, slots: Slot[], states: string[]): string {
  if (states.every((s) => s === 'full')) return pyDumps(result);
  const stubs = new Map<number, string>();
  states.forEach((state, i) => { if (state !== 'full') stubs.set(i, state === 'duplicate' ? DUPLICATE(slots[i]!.ref) : PRUNED_RECORD(slots[i]!.ref)); });
  let body: unknown = result.body!;
  const b = body as Rec;
  if (b.resourceType === 'Bundle') {
    const entries: unknown[] = [];
    let i = 0;
    for (let entry of (b.entry as Rec[] | undefined) ?? []) {
      if (isRecord(entry.resource)) {
        if (stubs.has(i)) entry = { ...entry, resource: stubs.get(i)! };
        i += 1;
      }
      entries.push(entry);
    }
    body = { ...b, entry: entries };
  } else body = stubs.get(0)!;
  return pyDumps({ ...result, body });
}

function requestLabel(raw: string): string {
  let label: string;
  try {
    const args = loadsStrict(raw || '{}');
    if (!isDict(args)) throw new Error('AttributeError');
    const field = (k: string) => (Object.hasOwn(args, k) ? pyStr(args[k]) : '');
    label = pyStrip(`${field('method')} ${field('path')}`);
  } catch {
    label = '';
  }
  if (label.toUpperCase() === 'POST' || label.toUpperCase() === 'POST /') label = 'POST (transaction)';
  return pyHead(label || 'fhir_request', LABEL_CHARS);
}

export interface Context1Options { budget: number; soft: number; hard: number; target: number; ramp_from: number; chars_per_token: number }
export const X16_OPTIONS: Context1Options = { budget: 16_384, soft: 0.60, hard: 0.85, target: 0.70, ramp_from: 15, chars_per_token: 3.5 };

export class Context1Profile {
  name = 'X';
  options: Context1Options;
  readonly fhirTool: unknown;
  system = '';
  prompt = '';
  opening = '';
  log: (Rec | Result)[] = [];
  results: Result[] = [];
  byCall = new Map<string, Result>();
  refPrunes = new Map<string, number>();
  harnessPruned: string[] = [];
  exposedKeys = new Set<string>();
  nudged = false;
  calibration: [number, number] | null = null;
  toolsChars = 0;

  /** fhirTool: the fhir_request schema as the locked harness advertises it (config tools[0]). */
  constructor(fhirTool: unknown, options: Partial<Context1Options> = {}) {
    this.fhirTool = fhirTool;
    this.options = { ...X16_OPTIONS, ...options };
  }

  interface(cap: number): string {
    const o = this.options;
    return INTERFACE(grouped(o.budget), cap, pyRound(o.soft * 100), pyRound(o.hard * 100));
  }

  tools(): unknown[] { return [this.fhirTool, PRUNE_TOOL]; }

  async run(ep: Episode, system: string, prompt: string, hooks: { onTool?: (call: ToolCallIn, res: Result) => void } = {}): Promise<string> {
    const section = this.interface(ep.max_root_turns);
    this.system = system ? `${system}\n\n${section}` : section;
    this.prompt = prompt;
    const tools = this.tools();
    this.toolsChars = pyLen(pyDumps(tools));
    this.opening = this.annotation(ep);
    for (;;) {
      const [messages, fresh, duplicates] = this.render();
      let reply: ModelReply;
      try {
        reply = await ep.model(messages, tools);
      } catch (e) {
        if (!(e instanceof TurnLimit)) throw e;
        ep.metrics.set('turn_cap_reached', 1);
        break;
      }
      this.shown(ep, fresh, duplicates);
      this.calibrate(messages, reply);
      this.log.push(reply.message);
      if (!reply.tool_calls.length) break;
      for (const call of reply.tool_calls) {
        const res = this.toolResult(ep, call);  // runs even without a hook (?. would skip it)
        hooks.onTool?.(call, res);
      }
      if (ep.root_turn < ep.max_root_turns) this.results[this.results.length - 1]!.annotation = this.annotation(ep);
    }
    return ep.last_root_content;
  }

  toolResult(ep: Episode, call: ToolCallIn): Result {
    const [args, error] = parseArguments(call.arguments);
    if (error !== null || args === null) {
      ep.metrics.add('invalid_tool_calls');
      return this.add(call, call.name || 'tool', error ?? '');
    }
    if (call.name === 'prune') return this.add(call, 'prune', this.prune(ep, args));
    if (call.name !== 'fhir_request') {
      ep.metrics.add('unknown_tool_calls');
      return this.add(call, pyHead(pyStr(call.name), LABEL_CHARS), UNKNOWN_TOOL(call.name));
    }
    const label = requestLabel(call.arguments);
    const { budget, hard } = this.options;
    const n = this.estimate();
    if (n >= hard * budget) {
      ep.metrics.add('hard_cutoff_rejections');
      ep.log('hard_cutoff', { tokens: n, request: label });
      return this.add(call, label, HARD_ERROR(n, budget, pyRound(hard * 100)));
    }
    const [content, result] = executeFhirRequest(ep, call.arguments);
    if (result === null) return this.add(call, label, content);
    return this.add(call, label, '', result);
  }

  add(call: ToolCallIn, label: string, text = '', result: FhirResult | null = null): Result {
    const index = this.results.length;
    const res: Result = {
      index, handle: `r${index + 1}`, call_id: call.id, label, text, result,
      slots: result !== null ? recordSlots(result) : [], pruned: '', annotation: '', shown: false, cache: new Map(),
    };
    this.results.push(res);
    this.log.push(res);
    this.byCall.set(call.id, res);
    return res;
  }

  // ---------------------------------------------------------------- pruning
  lookup(handle: string): Result | null {
    const key = pyStrip(pyStrip(handle).replace(/^[[\]]+|[[\]]+$/g, ''));
    const byCall = this.byCall.get(key);
    if (byCall) return byCall;
    const m = /^[rR]?(\d+)$/.exec(key);
    if (m && Number(m[1]) > 0 && Number(m[1]) <= this.results.length) return this.results[Number(m[1]) - 1]!;
    return null;
  }

  prune(ep: Episode, args: Rec): string {
    ep.metrics.add('prune_calls');
    let refs: unknown = Object.hasOwn(args, 'refs') ? args.refs : [];
    let handles: unknown = Object.hasOwn(args, 'results') ? args.results : [];
    if (typeof refs === 'string') refs = [refs];
    if (typeof handles === 'string') handles = [handles];
    if (!(Array.isArray(refs) && Array.isArray(handles) && [...refs, ...handles].every((x) => typeof x === 'string'))) {
      ep.metrics.add('invalid_tool_calls');
      return PRUNE_USAGE;
    }
    const doneResults: string[] = [], doneRefs: string[] = [], already: string[] = [], missing: string[] = [];
    for (const handle of handles as string[]) {
      const res = this.lookup(handle);
      if (res === null) missing.push(handle);
      else if (res.pruned) already.push(res.handle);
      else { res.pruned = 'model'; doneResults.push(res.handle); }
    }
    const cutoff = this.results.length;
    for (const key of (refs as string[]).map((r) => pyStrip(r))) {
      const holders = this.results.filter((res) => res.slots.some((slot) => slot.ref === key));
      const inView = holders.filter((res) => !res.pruned && res.index >= (this.refPrunes.get(key) ?? -1));
      if (inView.length) { this.refPrunes.set(key, cutoff); doneRefs.push(key); }
      else if (holders.length) already.push(key);
      else missing.push(key);
    }
    ep.metrics.add('pruned_results', doneResults.length);
    ep.metrics.add('pruned_refs', doneRefs.length);
    ep.metrics.add('prune_misses', missing.length);
    ep.log('prune', { results: doneResults, refs: doneRefs, already, missing });
    const parts: string[] = [];
    if (doneResults.length) parts.push('pruned results ' + doneResults.join(', '));
    if (doneRefs.length) parts.push('pruned records ' + doneRefs.join(', '));
    if (already.length) parts.push('already pruned ' + already.join(', '));
    if (missing.length) parts.push('not found ' + missing.map((m) => pyHead(m, 80)).join(', '));
    if (!(doneResults.length || doneRefs.length)) ep.metrics.add('prune_noops');
    return parts.join('; ') || 'nothing to prune: pass refs (Type/id) or results (handles such as r3)';
  }

  overflow(ep: Episode, n: number): string[] {
    const { budget, target } = this.options;
    const pruned: string[] = [];
    for (const res of this.results) {
      if (n <= target * budget) break;
      if (res.pruned) continue;
      res.pruned = 'harness';
      pruned.push(res.handle);
      this.harnessPruned.push(res.handle);
      n = this.estimate();
    }
    ep.metrics.add('overflow_events');
    ep.metrics.add('overflow_pruned_results', pruned.length);
    if (n > budget) ep.metrics.add('overflow_unresolved');
    ep.log('overflow', { pruned, tokens: n });
    return pruned;
  }

  // ---------------------------------------------------------------- budget
  static chars(messages: Rec[]): number {
    let total = 0;
    for (const message of messages) {
      const content = message.content;
      const text = typeof content === 'string' ? content : content ? pyStr(content) : '';
      total += MESSAGE_OVERHEAD + pyLen(text);
      for (const key of ['reasoning_content', 'reasoning']) if (typeof message[key] === 'string') total += pyLen(message[key] as string);
      for (const call of (message.tool_calls as Rec[] | undefined) ?? []) {
        const fn = (call.function as Rec | undefined) ?? {};
        total += pyLen(String(fn.name || '')) + pyLen(String(fn.arguments || ''));
      }
    }
    return total;
  }

  estimate(): number {
    const [messages] = this.render();
    const chars = Context1Profile.chars(messages);
    const perToken = this.options.chars_per_token;
    if (this.calibration) {
      const [tokens, base] = this.calibration;
      return Math.max(0, Math.ceil(tokens + (chars - base) / perToken));
    }
    return Math.ceil((chars + this.toolsChars) / perToken);
  }

  calibrate(messages: Rec[], reply: ModelReply): void {
    const usage = reply.usage ?? {};
    const tokens = Math.trunc(Number(usage.prompt_tokens || 0)) + Math.trunc(Number(usage.completion_tokens || 0));
    this.calibration = tokens > 0 ? [tokens, Context1Profile.chars(messages) + Context1Profile.chars([reply.message])] : null;
  }

  annotation(ep: Episode): string {
    const o = this.options;
    const budget = o.budget;
    let n = this.estimate();
    const pruned = n > budget ? this.overflow(ep, n) : [];
    if (pruned.length) n = this.estimate();
    const turn = ep.root_turn + 1, cap = ep.max_root_turns;
    const parts = [TOKEN_LINE(n, budget, turn, cap)];
    if (pruned.length) parts.push(OVERFLOW_LINE(pruned.join(', ')));
    if (n >= o.hard * budget) {
      this.nudged = true;
      ep.metrics.add('hard_notes');
      parts.push(HARD_NOTE(pyRound(o.hard * 100)));
    } else if (n >= o.soft * budget && !this.nudged) {
      this.nudged = true;
      ep.metrics.add('soft_nudges');
      parts.push(NUDGE(pyRound(o.soft * 100)));
    }
    if (turn >= cap) parts.push(LAST_TURN);
    else if (turn >= o.ramp_from) {
      ep.metrics.add('ramp_notes');
      parts.push(RAMP(cap - turn + 1));
    }
    ep.metrics.set('peak_token_estimate', Math.max(ep.metrics.at('peak_token_estimate'), n));
    ep.log('budget', { tokens: n, next_turn: turn });
    return parts.join(' ');
  }

  // ---------------------------------------------------------------- render
  /** [messages, records shown in full and not yet exposed, duplicate stubs in results not yet shown]. */
  render(): [Rec[], Slot[], number] {
    const visible = new Set<string>();
    const fresh: Slot[] = [];
    let duplicates = 0;
    const contents = new Map<number, string>();
    for (const res of this.results) {
      let content: string;
      if (res.pruned) content = PRUNED_RESULT(res.handle, res.label);
      else if (res.result === null) content = `[${res.handle}] ${res.text}`;
      else {
        const states: string[] = [];
        for (const slot of res.slots) {
          if (res.index < (this.refPrunes.get(slot.ref) ?? -1)) states.push('pruned');
          else if (slot.searchset && visible.has(slot.key)) states.push('duplicate');
          else {
            states.push('full');
            visible.add(slot.key);
            if (!this.exposedKeys.has(slot.key)) fresh.push(slot);
          }
        }
        if (!res.shown) duplicates += states.filter((s) => s === 'duplicate').length;
        const signature = states.join(',');
        let payload = res.cache.get(signature);
        if (payload === undefined) res.cache.set(signature, payload = renderPayload(res.result, res.slots, states));
        content = `[${res.handle}] ${payload}`;
      }
      if (res.annotation) content += '\n\n' + res.annotation;
      contents.set(res.index, content);
    }
    let user = this.prompt;
    if (this.opening) user += '\n\n' + this.opening;
    if (this.harnessPruned.length) user += '\n\n' + PINNED(this.options.budget, this.harnessPruned.join(', '));
    const messages: Rec[] = [{ role: 'system', content: this.system }, { role: 'user', content: user }];
    for (const item of this.log) {
      if (isResult(item)) messages.push({ role: 'tool', tool_call_id: item.call_id, content: contents.get(item.index)! });
      else messages.push(item);
    }
    return [messages, fresh, duplicates];
  }

  /** A model call returned: everything it was sent reached the model. */
  shown(ep: Episode, fresh: Slot[], duplicates: number): void {
    for (const res of this.results) res.shown = true;
    ep.metrics.add('duplicate_stubs', duplicates);
    for (const slot of fresh) {
      if (this.exposedKeys.has(slot.key)) continue;
      this.exposedKeys.add(slot.key);
      const record = slot.record;
      ep.exposeFields(slot.ref, Object.keys(record));
      const ordered: Rec = { resourceType: record.resourceType, id: record.id, ...record };
      ep.exposeText(pyDumps(ordered), 'render');
    }
  }
}

function isResult(item: Rec | Result): item is Result {
  return typeof (item as Result).handle === 'string' && Object.hasOwn(item, 'slots') && Object.hasOwn(item, 'cache');
}
