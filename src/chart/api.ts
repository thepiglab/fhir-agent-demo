// The Chart assistant's server, in the browser. chart.html's inline shim routes the page's
// /api/* requests here. The read-only views come from files that the fhir-env repo's
// scripts/web_demo/export_chart_site.py wrote with demo/app.py's own code (see data.ts). The
// FHIR console and question answering run live: the model on WebGPU, its fhir_request calls
// against the ported FhirStore (src/fhir/store.ts), and the explanations in trace.ts.
//
// Writes:
//   - a benchmark question runs in a fresh episode store, built as the evaluator builds it
//     (episodeStore from the task row), and is graded by the ported scorer;
//   - a free question and the FHIR console share one sandbox per patient, as demo/app.py's
//     ChartSession: any record type may be written, the patient's own records may be deleted,
//     and it keeps its changes until /api/reset.
import { FhirStore, PARAMS, episodeStore, patientRef, pyDumps, ref } from '../fhir/store.ts';
import type { AuditEntry } from '../fhir/store.ts';
import { absenceChecked, effectGraded, evaluateTraining } from '../fhir/scoring.ts';
import type { TrainingOptions } from '../fhir/scoring.ts';
import type { Rec } from '../fhir/pyrt.ts';
import type { Tool, ChatMessage, GenerateOptions } from '../../vendor/lfm3-webgpu-pi/Lfm3ForCausalLM.js';
import type { ChartPatient } from '../types.ts';
import { activeCohort, dataUrl, ensureEnv, fetchData, selection } from './data.ts';
import type { Cohort, ShardFile, TaskRow } from './data.ts';
import * as T from './trace.ts';
import { argumentError, preParse } from '../fhir/tools.ts';
import { Context1Profile, Episode as HarnessEpisode } from '../fhir/context1.ts';
import { Context1V2Profile } from '../fhir/context1_v2.ts';
import { loadTokenizer } from '../fhir/tokenizer.ts';
import type { ModelReply } from '../fhir/context1.ts';
import { LONG_CONTEXT_TOKENS, MODEL_REPETITION_PENALTY, activeHarness, contextTokens } from '../model/config.ts';
import type { Inputs, Trace as TraceBase } from './trace.ts';
import { checkReply, cleanReply, replyEvidence, replyMessages } from './reply.ts';
import { GUARD_TEXT, THINKING_BUDGET, thinkingGuard } from './guard.ts';
import type { GuardStop } from './guard.ts';
import type { ReplyInput, ReplyResult } from './reply.ts';

// --- exported data -----------------------------------------------------------------------------

/** config.json: what demo/app.py's /api/config returns, minus server settings. */
interface ChartConfig {
  system_prompt: string;
  tools: Tool[];
  mrn_system: string;
  max_turns?: number;
  max_tool_calls?: number;
  preview_chars?: number;
  contracts: Record<string, string>;
  requests?: Record<string, string[]>;
  [key: string]: unknown;
}
/** A patient of a cohort's patients.json: the ChartIndex entry and the shard that holds the chart. */
type PatientEntry = ChartPatient & { shard_sha: string };
/** charts/<sha>/<patient>.json */
interface ChartFile {
  patient: ChartPatient;
  summary: Rec;
  chart: Rec;
  views: Record<string, Rec & { readable?: { narrative?: string | null; facts?: unknown[] } }>;
}

/** The page's request body (demo/static/index.html's api() and ask()). */
interface Payload {
  session?: string;
  patient?: string;
  ref?: string;
  method?: string;
  path?: string;
  body?: unknown;
  if_match?: string;
  if_none_exist?: string;
  question?: string;
  /** true: a reply turn after a free-response answer. Off unless asked: the page asks only from its experimental developer toggle. */
  reply?: boolean;
  /** 'L' or 'X16'; default: the model's harness (src/model/config.ts, ?harness=). */
  harness?: string;
  family?: string | null;
  stream?: boolean;
  max_turns?: number | null;
  max_tool_calls?: number | null;
  temperature?: number;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const config = () => fetchData<ChartConfig>('config.json');

/** The benchmark's evaluation settings (the corpus's options) and its tool-call budget. */
export const EVALUATION: Required<TrainingOptions> = {
  efficiency_weight: 0, answer_mode: 'json_or_fence', retrieval_weight: 0, reward_mode: 'strict',
  interface: 'v0.5', scoring_version: 'v0.6',
};
export const BENCHMARK_CALLS = 40;
const UNLIMITED = Infinity;

interface Located { cohort: Cohort; entry: PatientEntry; chart: ChartFile; shard: ShardFile }
async function patientData(id: unknown): Promise<Located> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9.-]{1,64}$/.test(id)) throw new HttpError(400, 'patient must be an id');
  const cohort = await activeCohort();
  const { patients } = await fetchData<{ patients: PatientEntry[] }>(`${cohort.id}/patients.json`);
  const entry = patients.find((p) => p.id === id);
  if (!entry) throw new HttpError(404, `Unknown patient ${JSON.stringify(id)}`);
  const [chart, shard] = await Promise.all([
    fetchData<ChartFile>(`charts/${entry.shard_sha}/${id}.json`),
    fetchData<ShardFile>(`shards/${entry.shard_sha}.json`),
  ]);
  return { cohort, entry, chart, shard };
}

// --- the sandbox (demo/app.py's ChartSession) ------------------------------------------------------

const sandboxes = new Map<string, FhirStore>();
const sandboxKey = (entry: PatientEntry): string => `${entry.shard_sha}/${entry.id}`;
const sandboxChanges = (entry: PatientEntry): number => sandboxes.get(sandboxKey(entry))?.audit.length ?? 0;

/** A record's patient reference; null for shared or multi-patient records (demo/app.py's owner). */
function ownerOf(resource: Rec): string | null {
  try { return patientRef(resource); } catch { return null; }
}

/** The patient's private copy of its shard: any type writable, own records deletable, Slots updatable. */
async function sandboxFor({ entry, shard }: Located): Promise<FhirStore> {
  const key = sandboxKey(entry);
  let store = sandboxes.get(key);
  if (!store) {
    await ensureEnv();
    const own = entry.ref;
    const resources = shard.resources as Rec[];
    store = episodeStore({
      patient_id: entry.id,
      omit: [],
      writable_types: [...PARAMS.keys()].sort(),
      delete_refs: resources.filter((r) => ownerOf(r) === own && r.resourceType !== 'Patient').map((r) => ref(r)).sort(),
      writable_refs: resources.filter((r) => r.resourceType === 'Slot').map((r) => ref(r)).sort(),
    }, resources, UNLIMITED, 'v0.5');
    sandboxes.set(key, store);
  }
  return store;
}

// --- read-only routes ----------------------------------------------------------------------------

async function apiConfig(): Promise<Record<string, unknown>> {
  const cohort = await activeCohort();
  const { modelName } = await import('./model-host.ts');
  return {
    ...(await config()), model: modelName, base_url: 'this browser (WebGPU)', browser_model: true,
    sampling: { ...SAMPLING }, max_tokens: 2048, data_dir: `${cohort.label} · ${cohort.tasks.toLocaleString()} tasks`,
  };
}

/** A record the sandbox changed, as the Record panel shows it: the card, what it says, the raw JSON. */
function liveView(key: string, resource: Rec, base: ChartFile['views'][string] | undefined, inputs: Inputs): Rec {
  const view: Rec = base ?? { owner: ownerOf(resource), scope: 'other', outgoing: [], incoming: [] };
  return {
    ...view,
    ref: key, type: resource.resourceType, date: T.recordDate(resource), label: T.safeLabel(resource, inputs), status: T.statusText(resource),
    resource,
    readable: { ...(base?.readable ?? {}), narrative: base?.readable?.narrative ?? null, facts: T.facts(resource, inputs) },
  };
}

async function resourceView(payload: Payload): Promise<unknown> {
  const key = payload.ref;
  if (typeof key !== 'string' || !/^[A-Z][A-Za-z]+\/[A-Za-z0-9.-]{1,64}$/.test(key)) throw new HttpError(400, 'ref must be a relative Type/id reference');
  const found = await patientData(payload.patient);
  const { entry, chart, shard } = found;
  const store = sandboxes.get(sandboxKey(entry));
  const changes = store?.audit.length ?? 0;
  const base = chart.views[key];
  if (store) {
    const live = store.resources.get(key);
    const touched = store.audit.some((e) => e.ref === key);
    if (!live) throw new HttpError(404, `No ${key} in this chart`);
    if (touched) {
      const inputs = { ...(shard.inputs as Inputs), resources: store.resources };
      return { ...liveView(key, live, base, inputs), changes };
    }
  }
  if (base) return { ...base, changes };
  const resource = shard.resources.find((r) => `${r.resourceType}/${r.id}` === key);
  if (!resource) throw new HttpError(404, `No ${key} in this patient's shard`);
  // Outside the patient's own and linked records: the card and the raw record.
  return { ...shard.cards[key], owner: null, scope: 'other', resource, readable: { narrative: null, facts: [] }, outgoing: [], incoming: [], changes };
}

// --- the FHIR console ----------------------------------------------------------------------------

async function consoleRequest(payload: Payload): Promise<unknown> {
  const found = await patientData(payload.patient);
  const method = String(payload.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(400, 'method must be GET, POST, PUT or DELETE');
  if (typeof payload.path !== 'string') throw new HttpError(400, 'path must be a string');
  const store = await sandboxFor(found);
  const headers: Record<string, string> = {};
  if (payload.if_match) headers['If-Match'] = String(payload.if_match);
  if (payload.if_none_exist) headers['If-None-Exist'] = String(payload.if_none_exist);
  const body = method === 'POST' || method === 'PUT' ? payload.body ?? null : null;
  store.active_tool = 'console';
  store.max_calls = UNLIMITED;
  const t0 = performance.now();
  const result = store.request(method, payload.path, body, headers);
  return { ...result, ms: Math.round((performance.now() - t0) * 100) / 100, changes: store.audit.length };
}

// --- asking ----------------------------------------------------------------------------------------

/** demo/app.py's user_prompt: the request, the context line, and optionally the family's contract. */
function userPrompt(cfg: ChartConfig, patient: ChartPatient, question: string, family: string | null): string {
  const context = patient.mrn
    ? `Context: patient MRN ${patient.mrn} (identifier system ${cfg.mrn_system}); as-of date ${patient.as_of}, treated as today.`
    : `Context: known patient ${patient.ref}; as-of date ${patient.as_of}, treated as today.`;
  const parts = [question.trim(), context];
  if (family) {
    const contract = cfg.contracts[family];
    if (!contract) throw new HttpError(400, `Unknown question family: ${JSON.stringify(family)}`);
    parts.push(contract);
  }
  return parts.join('\n');
}

/** The patient's benchmark task whose prompt this is: the chosen one if it matches, else any. */
async function findTask(cohort: Cohort, patientId: string, question: string): Promise<TaskRow | null> {
  const file = await fetchData<{ tasks: TaskRow[] }>(`${cohort.id}/tasks/${patientId}.json`).catch(() => null);
  if (!file) return null;
  const wanted = question.trim();
  const chosen = selection.taskId ? file.tasks.find((t) => t.id === selection.taskId && t.prompt.trim() === wanted) : undefined;
  return chosen ?? file.tasks.find((t) => t.prompt.trim() === wanted) ?? null;
}

/** A stream event: start, model_call, prefill, delta (streamed reasoning or answer text), step, done, error. */
type Event = Record<string, unknown> & { event: string };
/** A chunk of the model's output as it is generated. */
export interface DeltaEvent { event: 'delta'; turn: number; kind: 'reasoning' | 'text'; text: string }
/** Prompt prefill progress of a turn (tokens done of total). */
export interface PrefillEvent { event: 'prefill'; turn: number; done: number; total: number }
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

/** What the ported scorer said about a benchmark run (rendered by benchmark.ts). */
export interface BenchmarkResult {
  cohort: string;
  task_id: string;
  family: string;
  label: string;
  /** evaluate_training's metrics, or null with `error` when scoring failed. */
  metrics: Record<string, unknown> | null;
  error?: string;
  final_text: string;
  /** Natural-track rule: evidence is graded by retrieval, not by what the reply cites. */
  effect_graded: boolean;
  gold: Record<string, unknown>;
  /** The episode's writes, in order (method and reference). */
  audit: { method: string; ref: string }[];
  task: { track?: string | null; persona?: string | null; style?: string | null; premise?: boolean | null; prompt: string };
  /**
   * The absence rule, where the task has one (answers that something is not in the chart): what an
   * empty, bounded search must cover (type, patient, and a code, tag or identifier), and whether
   * the run made one. Strict success needs it; the metrics carry no field of their own for it.
   */
  absence?: { scope: Record<string, unknown>; checked: boolean } | null;
}

/** run_agent's trace; trace.ts's finishTrace fills sources, claims and verification at the end. */
interface Trace extends TraceBase {
  /** The harness the run used: L (locked), X16 (src/fhir/context1.ts) or X16v2 (context1_v2.ts). */
  harness?: 'L' | 'X16' | 'X16v2';
  id: string; model: string; patient: string; prompt: string;
  limits: { max_turns: number; max_tool_calls: number };
  stop_reason: string | null; error: string | null;
  turns: number; tool_calls: number; chart_requests: number;
  usage: Usage; seconds: number | null;
  task: Rec | null;
  benchmark?: BenchmarkResult;
  /** The reply turn's input, when the run gets one (free-response answers only); kept out of the stream. */
  reply_input?: ReplyInput;
}

// --- the tool layer (FastMCP's argument checks) ----------------------------------------------------

// Argument decoding and FastMCP's validation live in src/fhir/tools.ts (shared with harness X16).
export { argumentError } from '../fhir/tools.ts';

/** Python's repr() of a string, as FastMCP's errors quote tool names. */
const pyRepr = (s: unknown): string => T.pyStr([String(s)]).slice(1, -1);

/** The runtime's ContextOverflowError ("the conversation needs N tokens ... but the context holds M"). */
const isContextOverflow = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'ContextOverflowError' || /the context holds \d+/.test(error.message));
/** What the conversation says when a question outgrew the context. */
export function tooLong(context: number): string {
  const base = `This question needed more than the ${context.toLocaleString('en-US')} tokens of context this browser keeps, so the run stopped before answering.`;
  return context < LONG_CONTEXT_TOKENS ? `${base} Turn on Long charts in the ⋯ menu (${LONG_CONTEXT_TOKENS.toLocaleString('en-US')} tokens, more memory) and ask again.` : base;
}

/** Tokens per model reply (thinking included): 2048, or ?max_new_tokens= in the dev server only. */
function replyCap(): number {
  const wanted = import.meta.env?.DEV && globalThis.location ? Number(new URLSearchParams(globalThis.location.search).get('max_new_tokens')) : 0;
  return Number.isInteger(wanted) && wanted >= 256 && wanted <= 8192 ? wanted : 2048;
}

/** Reasoning tokens per turn before the guard stops it: THINKING_BUDGET, or ?thinking_budget= in the dev server only (measurement). */
function thinkingBudget(): number {
  const wanted = import.meta.env?.DEV && globalThis.location ? Number(new URLSearchParams(globalThis.location.search).get('thinking_budget')) : 0;
  return Number.isInteger(wanted) && wanted >= 256 && wanted <= 8192 ? wanted : THINKING_BUDGET;
}

/** For tests: sees each message list harness X16 sends to the model. */
export const x16Probe: { onContext?: (messages: Rec[]) => void } = {};

/** The user stopped the run (X16: thrown out of the profile's loop). */
class Stopped extends Error {}
/** The thinking guard ended the run (X16: thrown out of the profile's loop). */
class Guarded extends Error {}

// One episode, as demo/app.py's run_agent: emits start, model_call and step events, then
// returns the trace (the caller emits done).
async function runAgent(payload: Payload, emit: (event: Event) => void, signal?: AbortSignal | null): Promise<Trace> {
  const cfg = await config();
  const found = await patientData(payload.patient);
  const { cohort, entry, shard } = found;
  const patient: ChartPatient = entry;
  const question = payload.question;
  if (typeof question !== 'string' || !question.trim()) throw new HttpError(400, 'question must be a non-empty string');
  if (question.length > 8000) throw new HttpError(400, 'question is longer than 8000 characters');
  const family = payload.family || null;
  // A benchmark task's exact prompt is sent as is (it states its own context and contract).
  const taskRow = await findTask(cohort, entry.id, question);
  const prompt = taskRow ? taskRow.prompt : userPrompt(cfg, patient, question, family);
  const maxTurns = payload.max_turns || cfg.max_turns || 20;
  const maxToolCalls = taskRow ? BENCHMARK_CALLS : payload.max_tool_calls || cfg.max_tool_calls || 40;
  const host = await import('./model-host.ts');
  const model = await host.startModel();
  if (!model) throw new Error('The model is not loaded. Download it on the model page first.');
  await ensureEnv();
  // A benchmark question runs in a fresh episode, exactly the evaluator's; any other question
  // works in the patient's sandbox copy and keeps what it changes until Reset chart.
  const store: FhirStore = taskRow ? episodeStore(taskRow, shard.resources as Rec[], BENCHMARK_CALLS, EVALUATION.interface) : await sandboxFor(found);
  const auditStart = store.audit.length;
  const shardInputs = (shard.inputs ?? { names: {}, cards: {} }) as Inputs;
  const withRecords = (resources: Map<string, Rec>): Inputs => ({ ...shardInputs, resources });
  const names = new Set(cfg.tools.map((t) => t.function.name));
  const messages: ChatMessage[] = [{ role: 'system', content: cfg.system_prompt }, { role: 'user', content: prompt }];
  const trace: Trace = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12), model: host.modelName, patient: entry.id, prompt,
    limits: { max_turns: maxTurns, max_tool_calls: maxToolCalls }, steps: [], final: null, stop_reason: null, error: null,
    turns: 0, tool_calls: 0, chart_requests: 0, usage: {}, seconds: null, changes: [], task: null, sources: [],
  };
  const retrieved: Record<string, number[]> = {};
  let lastReply = '';
  emit({ event: 'start', trace: { id: trace.id, model: trace.model, patient: trace.patient, prompt, limits: trace.limits } });
  const options: GenerateOptions = {
    tools: cfg.tools, enable_thinking: true, max_new_tokens: replyCap(),
    // The RL eval preset: temperature 0.1, top_k 50 and a seed, which the runtime ignores for our
    // GGUFs (it decodes greedily, so a question gives the same run each time), and the model's own
    // repetition penalty (MODEL_REPETITION_PENALTY; 1 = off).
    temperature: Number(payload.temperature ?? SAMPLING.temperature), top_k: SAMPLING.top_k, seed: SAMPLING.seed,
    repetition_penalty: repetitionPenalty(),
  };
  /** Stops the run cleanly when a turn's thinking runs past its budget or loops. */
  const guarded = (stop: GuardStop) => { trace.stop_reason = stop; trace.error = GUARD_TEXT[stop]; };
  const session = model.create_session();
  const started = performance.now();
  const harness = payload.harness === 'X16' || payload.harness === 'X16v2' || payload.harness === 'L' ? payload.harness : activeHarness();
  trace.harness = harness;

  // Harness X16 (src/fhir/context1.ts), the harness LFM3 SFT v0.6.1-X16 was trained in. The
  // profile owns the context: it rebuilds the message list every turn (handles, stubs, the budget
  // line) and calls the model through this adapter. The model sees its own runtime messages for
  // its past turns, as in L; the profile keeps the vLLM-shaped dict (content, role, tool_calls
  // with JSON-text arguments, reasoning_content) for its token estimate.
  const runX16 = async (): Promise<void> => {
    const profile = harness === 'X16v2'
      ? new Context1V2Profile(cfg.tools[0], await loadTokenizer(dataUrl('tokenizer/')))
      : new Context1Profile(cfg.tools[0]);
    const tools = profile.tools() as Tool[];
    const runtimeOf = new WeakMap<Rec, ChatMessage>();
    let turn = 0;
    let last: { finish: string; calls: number; text: string } = { finish: '', calls: 0, text: '' };
    const chat = async (harnessMessages: Rec[]): Promise<ModelReply> => {
      if (signal?.aborted) throw new Stopped();
      x16Probe.onContext?.(harnessMessages);
      turn += 1;
      emit({ event: 'model_call', turn });
      const t0 = performance.now();
      const input = harnessMessages.map((m) => runtimeOf.get(m) ?? (m as unknown as ChatMessage));
      const gen = session.generate(input, { ...options, tools });
      const guard = thinkingGuard(thinkingBudget());
      let stop: GuardStop | null = null;
      for await (const event of gen) {
        if (signal?.aborted) { gen.cancel(); break; }
        // The piece that trips the guard is shown too: the runtime can release a long buffered chunk at once.
        if (event.type === 'reasoning' || event.type === 'text') emit({ event: 'delta', turn, kind: event.type, text: event.text });
        else if (event.type === 'prefill') emit({ event: 'prefill', turn, done: event.done, total: event.total });
        if (event.type === 'reasoning' && (stop = guard.feed(event.text))) { gen.cancel(); break; }
      }
      const r = await gen.result;
      if (signal?.aborted) throw new Stopped();
      if (stop) { guarded(stop); throw new Guarded(); }
      const calls = (r.message.tool_calls || []).map((c, i) => ({
        id: c.id || `call_${turn}_${i}`, name: c.function.name,
        // vLLM's LFM3 tool parser hands the harness json.dumps(arguments, ensure_ascii=False)
        // (", " and ": "; non-ASCII kept), as the recorded LFM3 eval traces show.
        arguments: pyDumps(c.function.arguments ?? {}),
      }));
      const message: Rec = {};
      if (r.message.content) message.content = r.message.content;
      message.role = 'assistant';
      if (calls.length) message.tool_calls = calls.map((c) => ({ id: c.id, function: { arguments: c.arguments, name: c.name }, type: 'function' }));
      if (r.message.reasoning_content) message.reasoning_content = r.message.reasoning_content;
      runtimeOf.set(message, r.message);
      const u = r.usage;
      const usage: Usage = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: (u.prompt_tokens || 0) + (u.completion_tokens || 0) };
      for (const k of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
        const value = usage[k];
        if (typeof value === 'number') trace.usage[k] = (trace.usage[k] || 0) + value;
      }
      const shown: Record<string, unknown> = { role: 'assistant', content: r.message.content ?? '' };
      if (r.message.reasoning_content) shown.reasoning_content = r.message.reasoning_content;
      if (calls.length) shown.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }));
      const [reasoning, text] = T.splitReasoning(shown);
      const step = {
        type: 'assistant' as const, turn, seconds: Math.round(performance.now() - t0) / 1000, finish_reason: r.finish_reason, usage, reasoning, content: text,
        tool_calls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })), message: shown,
      };
      trace.steps.push(step);
      trace.turns = turn;
      emit({ event: 'step', step });
      last = { finish: r.finish_reason, calls: calls.length, text };
      return { content: r.message.content ?? '', tool_calls: calls, message, usage: { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens }, finish_reason: r.finish_reason };
    };
    const ep = new HarnessEpisode(store, chat, { max_root_turns: maxTurns, deferred_exposure: true });
    // The sandbox lasts across questions; this run's budget is what it has left.
    const savedMax = store.max_calls;
    if (!taskRow) store.max_calls = store.events.length + maxToolCalls;
    try {
      await profile.run(ep, cfg.system_prompt, prompt, {
        onTool: (call, res) => {
          const t1 = performance.now();
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.arguments) as Record<string, unknown>; } catch { /* shown as given */ }
          const content = res.result ? pyDumps(res.result) : res.text;
          trace.tool_calls += 1;
          trace.chart_requests += res.result ? 1 : 0;
          const [status, summary, refs] = T.describeResult(content);
          for (const key of new Set(refs)) (retrieved[key] ||= []).push(trace.tool_calls);
          const method = String(args.method || '').toUpperCase();
          const error = call.name === 'prune' ? false : status === null || status === undefined || status >= 400;
          const write = ['POST', 'PUT', 'DELETE'].includes(method);
          const preview = cfg.preview_chars || 4000;
          const toolStep = {
            type: 'tool' as const, turn, call: trace.tool_calls, id: call.id, name: call.name, arguments: args, status, summary,
            plain: call.name === 'prune' ? `Pruned ${res.text}` : T.requestWords(args, patient, withRecords(store.resources), error && write),
            outcome: call.name === 'prune' ? res.text : T.outcomeWords(method, status, content),
            write, refs: refs.slice(0, 100), error, counted: !!res.result,
            ms: Math.round((performance.now() - t1) * 10) / 10, chars: content.length,
            truncated: content.length > preview, content: content.slice(0, preview),
          };
          trace.steps.push(toolStep);
          emit({ event: 'step', step: toolStep });
        },
      });
    } finally {
      if (!taskRow) store.max_calls = savedMax;
    }
    lastReply = last.text;
    if (ep.metrics.at('hard_cap_exceeded')) {
      // X16v2: a real prompt past the budget ends the episode with no answer (the eval grades "").
      lastReply = '';
      trace.stop_reason = 'too_long';
      trace.error = tooLong(contextTokens());
    } else if (!last.calls && turn > 0) {
      trace.final = T.finalAnswer(last.text, last.finish);
      trace.stop_reason = 'final_answer';
    } else trace.stop_reason = ep.metrics.at('turn_cap_reached') ? 'max_turns' : trace.stop_reason;
  };

  try {
    if (harness === 'X16' || harness === 'X16v2') await runX16();
    else for (let turn = 1; turn <= maxTurns; turn++) {
      if (signal?.aborted) { trace.stop_reason = 'stopped'; break; }
      emit({ event: 'model_call', turn });
      const t0 = performance.now();
      const gen = session.generate(messages, options);
      const guard = thinkingGuard(thinkingBudget());
      let stop: GuardStop | null = null;
      for await (const event of gen) {
        if (signal?.aborted) { gen.cancel(); break; }
        // The piece that trips the guard is shown too: the runtime can release a long buffered chunk at once.
        if (event.type === 'reasoning' || event.type === 'text') emit({ event: 'delta', turn, kind: event.type, text: event.text });
        else if (event.type === 'prefill') emit({ event: 'prefill', turn, done: event.done, total: event.total });
        if (event.type === 'reasoning' && (stop = guard.feed(event.text))) { gen.cancel(); break; }
      }
      const r = await gen.result;
      if (stop) { trace.turns = turn; guarded(stop); break; }
      const seconds = (performance.now() - t0) / 1000;
      const runtimeMessage = r.message;
      messages.push(runtimeMessage);
      const calls = (runtimeMessage.tool_calls || []).map((c, i) => ({
        id: c.id || `call_${turn}_${i}`, type: 'function' as const, errors: c.errors,
        function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments ?? {}) }, parsed: c.function.arguments,
      }));
      const u = r.usage;
      const usage: Usage = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: (u.prompt_tokens || 0) + (u.completion_tokens || 0) };
      for (const k of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
        const value = usage[k];
        if (typeof value === 'number') trace.usage[k] = (trace.usage[k] || 0) + value;
      }
      // The OpenAI-style message the Python demo would have kept.
      const message: Record<string, unknown> = { role: 'assistant', content: runtimeMessage.content ?? '' };
      if (runtimeMessage.reasoning_content) message.reasoning_content = runtimeMessage.reasoning_content;
      if (calls.length) message.tool_calls = calls.map(({ id, type, function: f }) => ({ id, type, function: f }));
      const [reasoning, text] = T.splitReasoning(message);
      lastReply = text;
      const step = {
        type: 'assistant' as const, turn, seconds: Math.round(seconds * 1000) / 1000, finish_reason: r.finish_reason, usage, reasoning, content: text,
        tool_calls: calls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })), message,
      };
      trace.steps.push(step);
      trace.turns = turn;
      emit({ event: 'step', step });
      if (!calls.length) {
        trace.final = T.finalAnswer(text, r.finish_reason);
        trace.stop_reason = 'final_answer';
        break;
      }
      for (const call of calls) {
        const before = new Map(store.resources);  // names the records a write replaces
        const t1 = performance.now();
        const name = call.function.name;
        // FastMCP pre-parses a JSON-string body before validating (src/fhir/tools.ts).
        const args: Record<string, unknown> = preParse(call.parsed && typeof call.parsed === 'object' ? call.parsed : {});
        let content: string, counted = 0;
        if (!names.has(name)) content = `error: unknown tool ${pyRepr(name)}`;
        else if (call.errors?.length) content = `Error executing tool ${name}: ${call.errors.join('; ')}`;
        else {
          const invalid = argumentError(name, args);
          if (invalid) content = invalid;
          else {
            const events = store.events.length;
            store.active_tool = 'fhir_request';
            store.agent_tools.push('fhir_request');
            store.round = turn;
            // The sandbox lasts across questions; this run's budget is what it has left.
            if (!taskRow) store.max_calls = events + Math.max(maxToolCalls - trace.chart_requests, 0);
            try {
              content = store.fhirRequestObject({
                method: args.method as string, path: args.path as string, body: args.body,
                if_match: args.if_match as string | undefined, if_none_exist: args.if_none_exist as string | undefined,
              });
            } catch (error) {
              content = errorText(error);  // MCP returns a tool's failure as its text
            } finally {
              if (!taskRow) store.max_calls = UNLIMITED;
            }
            counted = store.events.length - events;
          }
        }
        trace.tool_calls += 1;
        trace.chart_requests += counted;
        messages.push({ role: 'tool', tool_call_id: call.id, content });
        const [status, summary, refs] = T.describeResult(content);
        for (const key of new Set(refs)) (retrieved[key] ||= []).push(trace.tool_calls);
        const method = String(args.method || '').toUpperCase();
        const error = status === null || status === undefined || status >= 400;
        const write = ['POST', 'PUT', 'DELETE'].includes(method);
        const preview = cfg.preview_chars || 4000;
        const toolStep = {
          type: 'tool' as const, turn, call: trace.tool_calls, id: call.id, name, arguments: args, status, summary,
          plain: T.requestWords(args, patient, withRecords(before), error && write),
          outcome: T.outcomeWords(method, status, content),
          write, refs: refs.slice(0, 100), error, counted: !!counted,
          ms: Math.round((performance.now() - t1) * 10) / 10, chars: content.length,
          truncated: content.length > preview, content: content.slice(0, preview),
        };
        trace.steps.push(toolStep);
        emit({ event: 'step', step: toolStep });
      }
    }
    if (!trace.stop_reason) trace.stop_reason = 'max_turns';
  } catch (error) {
    if (error instanceof Stopped) trace.stop_reason = 'stopped';
    else if (error instanceof Guarded) { /* stop_reason and error already set */ }
    else if (isContextOverflow(error)) {
      // The prompt outgrew the runtime's context (X16's budget is an estimate): end the episode.
      trace.stop_reason = 'too_long';
      trace.error = tooLong(contextTokens());
    } else {
      trace.stop_reason = 'error';
      trace.error = errorText(error);
    }
  } finally {
    await session.dispose();
    trace.seconds = Math.round(performance.now() - started) / 1000;
  }
  const inputs = withRecords(store.resources);
  const evidence = taskRow ? goldEvidence(taskRow) : null;
  T.finishTrace(trace, retrieved, inputs, patient, evidence ? { gold: evidence } : null);
  // What the run changed (change_view of each audit entry since it began), and the sandbox total.
  const made: AuditEntry[] = store.audit.slice(auditStart);
  trace.changes = made.map((e) => T.changeView(e, inputs));
  trace.sandbox_changes = taskRow ? sandboxChanges(entry) : store.audit.length;
  if (taskRow) {
    trace.task = { id: taskRow.id, family: taskRow.family, suite: cohort.id, gold: evidence, gold_answer: taskRow.gold.answer, skipped: null };
    trace.benchmark = grade(cohort, taskRow, store, lastReply);
  }
  // The reply turn (src/chart/reply.ts) is for free-response answers that cite records the agent
  // read; a benchmark question is scored on its structured answer and gets none.
  const final = trace.final;
  if (!taskRow && final && final.parsed && trace.stop_reason === 'final_answer' && payload.reply === true) {
    const read = new Set(Object.keys(retrieved));
    const evidence = replyEvidence(final.evidence, read, store.resources as Map<string, Rec>);
    if (evidence.length) {
      // The audit holds the writes that succeeded; the log gives each its HTTP status. Attempts the
      // chart refused are in it too, with their real status (the reply must not claim them).
      const refused = trace.steps
        .filter((s): s is typeof s & { type: 'tool'; arguments: Record<string, unknown> } => s.type === 'tool' && s.write === true && s.error === true)
        .map((s) => ({ method: String(s.arguments?.method ?? '').toUpperCase(), ref: String(s.arguments?.path ?? ''), status: s.status === null || s.status === undefined ? 'not run' : String(s.status) }));
      const writes = [
        ...made.map((e) => ({ method: e.method, ref: e.ref, status: String({ POST: 201, DELETE: 204 }[e.method] ?? 200) })),
        ...refused,
      ];
      trace.reply_input = { question, answer: final.answer, evidence, writes };
    }
  }
  return trace;
}

/** Reply turn options: no tools, no thinking, a few sentences. */
const REPLY_OPTIONS: GenerateOptions = { enable_thinking: false, max_new_tokens: 320, temperature: 0, top_k: 50, seed: 42 };

/** The RL evals' sampling preset (less its repetition penalty, see src/chart/guard.ts). Note the
 * runtime decodes greedily for these GGUFs, so temperature, top_k and seed are not applied. */
export const SAMPLING = { temperature: 0.1, top_k: 50, seed: 42 } as const;

/** MODEL_REPETITION_PENALTY (src/model/config.ts; 1 = off), or ?rep_penalty= in the dev server only (measurement; 1 turns it off). */
function repetitionPenalty(): number {
  const wanted = import.meta.env?.DEV && globalThis.location ? Number(new URLSearchParams(globalThis.location.search).get('rep_penalty')) : 0;
  return Number.isFinite(wanted) && wanted > 0 ? wanted : MODEL_REPETITION_PENALTY;
}

/** One tool-free model call that writes the clinician's reply, then the checks that gate it. */
async function writeReply(input: ReplyInput, emit: (event: Event) => void, signal?: AbortSignal | null): Promise<ReplyResult> {
  const host = await import('./model-host.ts');
  const model = await host.startModel();
  const t0 = performance.now();
  const result: ReplyResult = { state: 'failed', text: '', problems: [], refs: [], seconds: 0, usage: {} };
  if (!model) return { ...result, problems: ['the model is not loaded'] };
  const session = model.create_session();
  try {
    emit({ event: 'reply_start' });
    const gen = session.generate(replyMessages(input) as ChatMessage[], REPLY_OPTIONS);
    for await (const event of gen) {
      if (signal?.aborted) { gen.cancel(); break; }
      if (event.type === 'prefill') emit({ event: 'reply_progress', done: event.done, total: event.total });
    }
    const r = await gen.result;
    result.usage = { prompt_tokens: r.usage.prompt_tokens, completion_tokens: r.usage.completion_tokens };
    if (signal?.aborted) return { ...result, state: 'stopped' };
    result.text = cleanReply(r.message.content ?? '');
    const check = checkReply(result.text, input);
    result.state = check.ok ? 'shown' : 'refused';
    result.problems = check.problems;
    result.refs = check.refs;
  } catch (error) {
    result.problems = [errorText(error)];
  } finally {
    await session.dispose();
    result.seconds = Math.round(performance.now() - t0) / 1000;
  }
  return result;
}

/** The gold evidence references of a task row (what the run should cite). */
export function goldEvidence(task: Pick<TaskRow, 'gold'>): string[] {
  const evidence = task.gold.evidence;
  return Array.isArray(evidence) ? evidence.filter((r): r is string => typeof r === 'string') : [];
}

/** evaluate_training with the benchmark's settings, over the episode's store and the last reply. */
export function grade(cohort: Cohort, task: TaskRow, store: FhirStore, finalText: string): BenchmarkResult {
  const result: BenchmarkResult = {
    cohort: cohort.id, task_id: task.id, family: task.family, label: task._display.label, metrics: null, final_text: finalText,
    effect_graded: effectGraded(task, EVALUATION.scoring_version), gold: task.gold, audit: store.audit.map((e) => ({ method: e.method, ref: e.ref })),
    task: { track: task.track, persona: task.persona, style: task.style, premise: task.premise, prompt: task.prompt },
  };
  try {
    result.metrics = evaluateTraining(task, store, finalText, EVALUATION);
    const scope = (task as { absence_scope?: unknown }).absence_scope;
    result.absence = scope && typeof scope === 'object'
      ? { scope: scope as Record<string, unknown>, checked: absenceChecked(task, store, EVALUATION.interface, EVALUATION.scoring_version) }
      : null;
  } catch (error) {
    result.error = errorText(error);
  }
  return result;
}

function askStream(payload: Payload, signal?: AbortSignal | null): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const emit = (event: Event) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      try {
        const trace = await runAgent(payload, emit, signal);
        const input = trace.reply_input;
        delete trace.reply_input;
        emit({ event: 'done', trace, reply: input ? 'pending' : null });
        // The answer card is up; the reply follows it, and replaces nothing.
        if (input && !signal?.aborted) emit({ event: 'reply', reply: await writeReply(input, emit, signal) });
      } catch (error) {
        emit({ event: 'error', error: errorText(error) });
      }
      controller.close();
    },
  });
}

// --- router -------------------------------------------------------------------------------------------

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The patient's benchmark questions with their prompts (the picker's options). */
async function benchmarkTasks(patientId: unknown): Promise<unknown> {
  const { cohort, entry } = await patientData(patientId);
  const file = await fetchData<{ tasks: TaskRow[] }>(`${cohort.id}/tasks/${entry.id}.json`).catch(() => ({ tasks: [] as TaskRow[] }));
  return {
    cohort: cohort.id,
    tasks: file.tasks.map((t) => ({
      id: t.id, family: t.family, ...t._display, track: t.track ?? null, persona: t.persona ?? null, style: t.style ?? null,
      premise: t.premise ?? null, crud: t.crud ?? null, prompt: t.prompt, question: t.prompt,
    })),
  };
}

export async function handle(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  let payload: Payload = {};
  if (method === 'POST') {
    try { payload = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Payload; } catch { return respond(400, { error: 'Send a JSON object' }); }
  }
  try {
    switch (path) {
      case '/api/config': return respond(200, await apiConfig());
      case '/api/patients': {
        const cohort = await activeCohort();
        return respond(200, { cohort: cohort.id, ...(await fetchData<object>(`${cohort.id}/patients.json`)) });
      }
      case '/api/models': {
        const host = await import('./model-host.ts');
        host.startModel().catch(() => {});
        return respond(200, { models: [host.modelName], error: null });
      }
      case '/api/summary': {
        const { entry, chart } = await patientData(payload.patient);
        return respond(200, { ...chart.summary, changes: sandboxChanges(entry) });
      }
      case '/api/chart': {
        const { entry, chart } = await patientData(payload.patient);
        return respond(200, { ...chart.chart, changes: sandboxChanges(entry) });
      }
      case '/api/resource': return respond(200, await resourceView(payload));
      case '/api/fhir': return respond(200, await consoleRequest(payload));
      case '/api/reset': {
        const { entry } = await patientData(payload.patient);
        sandboxes.delete(sandboxKey(entry));
        return respond(200, { ok: true, changes: 0 });
      }
      case '/api/benchmark': return respond(200, await benchmarkTasks(payload.patient));
      case '/api/ask':
        if (!payload.stream) return respond(400, { error: 'This static demo answers with a stream' });
        return new Response(askStream(payload, init.signal), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
      default: return respond(404, { error: 'Not found' });
    }
  } catch (error) {
    return respond(error instanceof HttpError ? error.status : 500, { error: errorText(error) });
  }
}
