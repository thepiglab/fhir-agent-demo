// Shared state and events for the Chart assistant's parts.
//
// The parts (shell.ts, questions.ts, thread.ts, chart-panel.ts, model-gate.ts) talk only through
// this module: they read `app`, change it with the setters below, and listen with `on()`.
// The in-browser backend is src/chart/api.ts; `api()` calls its router directly (no fetch shim).
import type { ChartPatient } from '../types.ts';
import type { Cohort, QuestionRow } from '../chart/data.ts';
import { handle } from '../chart/api.ts';
import { selection } from '../chart/data.ts';
import { storage } from './dom.ts';

/** What /api/config returns (the exported config plus the in-browser model's facts). */
export interface AppConfig {
  system_prompt: string;
  tools: unknown[];
  search_params: Record<string, string[]>;
  type_nouns: Record<string, string>;
  /** Example questions: { suite, family, label, ... } rows from the clinical suites. */
  examples: Record<string, unknown>[];
  /** family -> answer contract text. */
  contracts: Record<string, string>;
  /** family -> natural example requests (physician, nurse, front desk wordings). */
  requests: Record<string, string[]>;
  max_turns: number;
  max_tool_calls: number;
  preview_chars: number;
  model: string;
  data_dir: string;
  [key: string]: unknown;
}

/** A benchmark question chosen for the composer: its index row plus the exact prompt. */
export interface ChosenQuestion extends QuestionRow {
  prompt: string;
  /** The answer contract, where the export keeps it apart from the prompt (natural v0.2.3.4+). */
  answer_contract?: string | null;
}

export type Mode = 'ask' | 'benchmark';
export type ModelStatus =
  | { state: 'checking' }
  | { state: 'absent'; bytes: number | null }                 // not in this browser yet
  | { state: 'loading'; phase: 'download' | 'gpu' | 'other'; loaded: number; total: number | null; message?: string }
  | { state: 'ready'; seconds: number }
  | { state: 'unsupported'; reason: string }                  // no WebGPU
  | { state: 'error'; message: string };

export const app = {
  config: null as AppConfig | null,
  cohort: null as Cohort | null,
  cohorts: [] as Cohort[],
  patients: [] as ChartPatient[],
  patient: null as ChartPatient | null,
  /** Type names the store knows (for Type/id reference links). */
  types: new Set<string>(),
  // Each visit starts with free-form Ask, regardless of the previous visit's mode.
  mode: 'ask' as Mode,
  question: null as ChosenQuestion | null,
  model: { state: 'checking' } as ModelStatus,
  dev: storage.get<boolean>('dev', false),
  /** A run is streaming (the composer is busy). */
  busy: false,
  /** Writes the patient's sandbox holds (from /api/summary's `changes`). */
  sandboxChanges: 0,
  /** The chart side panel is open (desktop: beside the conversation; phone: over it). */
  panelOpen: storage.get<boolean>('panel-open', window.matchMedia('(min-width: 1100px)').matches),
};

// ---------- events ----------
export interface Events {
  /** Config, cohorts and patients are loaded (once per page). */
  ready: void;
  patient: ChartPatient;
  mode: Mode;
  question: ChosenQuestion | null;
  model: ModelStatus;
  dev: boolean;
  busy: boolean;
  /** A run or the console changed the sandbox; parts that show the chart reload. */
  sandbox: { patient: string; changes: number };
  /** Open a record in the chart panel ("Observation/abc"). */
  openRecord: string;
  /** The chart panel opened or closed. */
  panel: boolean;
  /** Put text into the composer (an example question), optionally asking it at once. */
  compose: { text: string; send?: boolean };
}
type Handler<T> = (value: T) => void;
const handlers = new Map<keyof Events, Set<Handler<never>>>();
export function on<K extends keyof Events>(name: K, handler: Handler<Events[K]>): () => void {
  let set = handlers.get(name);
  if (!set) handlers.set(name, (set = new Set()));
  set.add(handler as Handler<never>);
  return () => set.delete(handler as Handler<never>);
}
export function emit<K extends keyof Events>(name: K, ...value: Events[K] extends void ? [] : [Events[K]]): void {
  for (const handler of handlers.get(name) ?? []) {
    try { (handler as Handler<unknown>)(value[0]); } catch (error) { console.error(`[${String(name)}]`, error); }
  }
}

// ---------- setters ----------
export function setPatient(patient: ChartPatient): void {
  if (app.patient?.id === patient.id) return;
  app.patient = patient;
  if (location.hash.slice(1) !== patient.id) history.replaceState(null, '', `${location.pathname}${location.search}#${patient.id}`);
  emit('patient', patient);
}
export function setMode(mode: Mode): void {
  if (app.mode === mode) return;
  app.mode = mode;
  emit('mode', mode);
}
/** Choose (or clear) the benchmark question; switches patient when the question is another patient's. */
export function setQuestion(question: ChosenQuestion | null): void {
  app.question = question;
  selection.taskId = question?.id ?? null;
  if (question && app.patient?.id !== question.patient) {
    const patient = app.patients.find((p) => p.id === question.patient);
    if (patient) setPatient(patient);
  }
  emit('question', question);
}
export function setModel(status: ModelStatus): void { app.model = status; emit('model', status); }
export function setDev(on: boolean): void {
  app.dev = on;
  storage.set('dev', on);
  document.body.classList.toggle('dev', on);
  emit('dev', on);
}
export function setPanel(open: boolean): void {
  app.panelOpen = open;
  storage.set('panel-open', open);
  document.body.classList.toggle('panel-open', open);
  emit('panel', open);
}
export function setBusy(busy: boolean): void { app.busy = busy; emit('busy', busy); }

// ---------- the in-browser API ----------
/** Call a JSON route of the in-browser backend (src/chart/api.ts). */
export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) };
  const response = await handle(path, init);
  const data = (await response.json().catch(() => ({ error: response.statusText }))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}
/** POST /api/ask: a stream of NDJSON events (see src/chart/api.ts askStream). */
export async function askStream(body: unknown, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const response = await handle('/api/ask', { method: 'POST', body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(data.error || response.statusText);
  }
  return response.body;
}

/** Is this string a Type/id reference to a type the store knows? */
const REF = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9.\-]{1,64})$/;
export const isRef = (s: string): boolean => { const m = REF.exec(s); return !!m && app.types.has(m[1]!); };
export const typeNoun = (type: unknown): string =>
  app.config?.type_nouns[String(type)] ?? String(type || 'record').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
