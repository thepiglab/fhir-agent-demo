// The conversation's data: one Run per question, kept per patient in memory, built live from the
// NDJSON event stream of /api/ask (start, model_call, prefill, delta, step, done, error).
// Framework-free; components subscribe with useRun / useThread (hooks.ts).
import { app, askStream, emit, setBusy } from '../../app/state.ts';
import { announce, plural } from '../../app/dom.ts';
import type { RunTrace, StreamEvent, ToolStepEvent } from './types.ts';
import type { ReplyResult } from '../../chart/reply.ts';
import { replyEnabled } from './replySetting.ts';

/** One session id for this page (the backend keys sandboxes and summaries by it). */
export const session = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One tool call: pending until its result arrives. */
export interface CallView {
  id: string;
  name: string;
  method: string;
  path: string;
  args: unknown;
  result: ToolStepEvent | null;
  /** The run ended before this call ran. */
  skipped: boolean;
}

export interface BenchInfo { label: string; family: string }
export type RunState = 'running' | 'done' | 'failed' | 'stopped';

/** A request's method and path from the call's arguments (a JSON string or an object). */
function request(raw: unknown): { method: string; path: string; args: unknown } {
  let args = raw;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* shown raw */ } }
  if (isObj(args)) return { method: String(args.method ?? '?').toUpperCase(), path: String(args.path ?? ''), args };
  return { method: '?', path: typeof args === 'string' ? args : JSON.stringify(args), args };
}

/** "Searched lab results for HbA1c" -> "Searching lab results for HbA1c" (the live status). */
export function presentTense(plain: string): string {
  const verbs: [RegExp, string][] = [
    [/^Searched /, 'Searching '], [/^Looked up /, 'Looking up '], [/^Opened /, 'Opening '], [/^Checked /, 'Checking '],
    [/^Created /, 'Creating '], [/^Updated /, 'Updating '], [/^Saved /, 'Saving '], [/^Deleted /, 'Deleting '],
    [/^Replaced /, 'Replacing '], [/^Tried to /, 'Trying to '], [/^Sent /, 'Sending '],
  ];
  for (const [from, to] of verbs) if (from.test(plain)) return plain.replace(from, to);
  return plain;
}

let nextId = 0;

export class Run {
  readonly id = ++nextId;
  readonly patient: string;
  readonly question: string;
  readonly bench: BenchInfo | null;
  readonly started = performance.now();
  readonly controller = new AbortController();
  state: RunState = 'running';
  /** What is happening now, in words. */
  phase = 'Reading the question';
  /** All turns' reasoning, one block per run. */
  reasoning = '';
  /** Reasoning is streaming right now. */
  thinking = false;
  /** Milliseconds spent producing reasoning, across turns. */
  thinkingMs = 0;
  private thinkingSince = 0;
  calls: CallView[] = [];
  prompt = '';
  trace: RunTrace | null = null;
  error = '';
  /** The reply turn: writing (after the answer card is up), then its checked result. */
  replyPending = false;
  reply: ReplyResult | null = null;
  /** The question outgrew the runtime's context (shown as a notice, not a failure). */
  tooLong = false;
  ended: number | null = null;
  /** Bumped on every change; components re-render on it. */
  version = 0;
  private listeners = new Set<() => void>();
  private frame = 0;

  constructor(patient: string, question: string, bench: BenchInfo | null) {
    this.patient = patient;
    this.question = question;
    this.bench = bench;
  }

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private notify(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.version += 1;
    for (const fn of this.listeners) fn();
  }
  /** Streamed text is painted at most once a frame. */
  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.notify(); });
  }

  get seconds(): number { return ((this.ended ?? performance.now()) - this.started) / 1000; }
  get finished(): boolean { return this.state !== 'running'; }
  get done(): ToolStepEvent[] { return this.calls.flatMap((c) => (c.result ? [c.result] : [])); }

  private stopThinking(): void {
    if (!this.thinking) return;
    this.thinking = false;
    this.thinkingMs += performance.now() - this.thinkingSince;
  }

  handle(message: StreamEvent): void {
    switch (message.event) {
      case 'start':
        this.prompt = message.trace.prompt;
        break;
      case 'model_call':
        this.stopThinking();
        this.phase = message.turn === 1 ? 'Reading the question' : 'Reading the results';
        break;
      case 'prefill':
        if (message.turn === 1 && message.total > 0 && message.done < message.total) {
          this.phase = `Reading the question · ${Math.round((100 * message.done) / message.total)}%`;
          this.schedule();
        }
        return;
      case 'delta':
        if (message.kind === 'reasoning') {
          if (!this.thinking) {
            this.thinking = true;
            this.thinkingSince = performance.now();
            if (this.reasoning.trim()) this.reasoning = this.reasoning.trimEnd() + '\n\n';
          }
          this.reasoning += message.text;
          this.phase = 'Thinking';
        } else {
          this.stopThinking();
          this.phase = 'Writing the answer';
        }
        this.schedule();
        return;
      case 'step': {
        const step = message.step;
        this.stopThinking();
        if (step.type === 'assistant') {
          if (step.tool_calls.length) {
            this.calls = [...this.calls, ...step.tool_calls.map((call) => {
              const { method, path, args } = request(call.arguments);
              return { id: call.id, name: call.name, method, path, args, result: null, skipped: false };
            })];
            this.phase = this.calls.at(-1)?.method === 'GET' || this.calls.at(-1)?.method === '?' ? 'Searching the chart' : 'Updating the chart';
          }
        } else {
          this.calls = this.calls.map((c) => (c.id === step.id ? { ...c, result: step } : c));
          this.phase = presentTense(step.plain || 'Searching the chart');
        }
        break;
      }
      case 'done':
        this.replyPending = message.reply === 'pending';
        this.finish(message.trace);
        return;
      case 'reply_start':
      case 'reply_progress':
        return;
      case 'reply':
        this.replyPending = false;
        this.reply = message.reply;
        if (message.reply.state === 'shown') announce('Summary ready.');
        break;
      case 'error': this.fail(message.error, false); return;
    }
    this.notify();
  }

  private end(state: RunState): void {
    this.stopThinking();
    this.state = state;
    this.ended = performance.now();
    this.calls = this.calls.map((c) => (c.result ? c : { ...c, skipped: true }));
  }

  finish(trace: RunTrace): void {
    if (this.finished) return;
    this.trace = trace;
    const stopped = trace.stop_reason === 'stopped' && !trace.final;
    if (!trace.final && trace.error) this.error = trace.error;
    this.tooLong = trace.stop_reason === 'too_long';
    this.end(stopped ? 'stopped' : !trace.final && trace.error ? 'failed' : 'done');
    if (trace.seconds !== null) this.ended = this.started + trace.seconds * 1000;
    announce(stopped ? 'Stopped.' : trace.final ? 'Answer ready.' : 'No answer.');
    const changed = (trace.changes ?? []).length;
    if (changed && !trace.benchmark) {
      const total = trace.sandbox_changes ?? changed;
      app.sandboxChanges = total;
      emit('sandbox', { patient: this.patient, changes: total });
    }
    this.notify();
  }

  /** The stream closed: a reply still pending will not come (stopped or failed). */
  closeReply(): void {
    if (!this.replyPending) return;
    this.replyPending = false;
    this.notify();
  }

  fail(message: string, stopped: boolean): void {
    if (this.finished) return;
    this.error = message;
    this.end(stopped ? 'stopped' : 'failed');
    announce(stopped ? 'Stopped.' : 'No answer: ' + message);
    this.notify();
  }

  /** "Worked for 14s · 3 searches". */
  summary(): string {
    const results = this.done;
    const searches = results.filter((r) => !r.write).length, writes = results.filter((r) => r.write && !r.error).length;
    const parts = [searches ? plural(searches, 'search', 'searches') : null, writes ? plural(writes, 'change') : null].filter(Boolean);
    return parts.join(' · ');
  }
}

// ---------- the threads: runs per patient ----------
const threads = new Map<string, Run[]>();
const threadListeners = new Set<() => void>();
let threadVersion = 0;
const EMPTY: Run[] = [];

export const threadStore = {
  subscribe(fn: () => void): () => void { threadListeners.add(fn); return () => { threadListeners.delete(fn); }; },
  version: () => threadVersion,
  runs: (patient: string | undefined): Run[] => (patient ? threads.get(patient) ?? EMPTY : EMPTY),
};
function addRun(run: Run): void {
  threads.set(run.patient, [...(threads.get(run.patient) ?? []), run]);
  threadVersion += 1;
  for (const fn of threadListeners) fn();
}

let current: Run | null = null;
export const currentRun = (): Run | null => current;
export function stop(): void { current?.controller.abort(); }

/** Ask a question about the current patient and stream the run into its thread. */
export async function ask(text: string, bench: BenchInfo | null): Promise<void> {
  const patient = app.patient;
  const question = text.trim();
  if (!patient || !question || app.busy || app.model.state !== 'ready') return;
  const run = new Run(patient.id, question, bench);
  current = run;
  addRun(run);
  setBusy(true);
  announce('Asking.');
  const payload = {
    session, patient: patient.id, question, stream: true, reply: replyEnabled(),
    family: null, model: null, max_turns: null, max_tool_calls: null,
  };
  try {
    const body = await askStream(payload, run.controller.signal);
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const take = (line: string) => { if (line.trim()) run.handle(JSON.parse(line) as StreamEvent); };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        take(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
    take(buffer);
    if (!run.finished) run.fail('The stream closed before the run finished.', run.controller.signal.aborted);
  } catch (error) {
    const aborted = run.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    run.fail(error instanceof Error ? error.message : String(error), aborted);
  } finally {
    if (current === run) current = null;
    run.closeReply();
    setBusy(false);
  }
}

/** Replay recorded events into a new run (development aid: window.__replay in hooks). */
export function replay(patient: string, question: string, events: StreamEvent[], bench: BenchInfo | null = null, delay = 60): Run {
  const run = new Run(patient, question, bench);
  addRun(run);
  let i = 0;
  const tick = () => {
    const event = events[i++];
    if (!event) return;
    run.handle(event);
    setTimeout(tick, event.event === 'delta' ? 15 : delay);
  };
  tick();
  return run;
}
