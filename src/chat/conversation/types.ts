// Shapes of /api/ask's NDJSON stream (src/chart/api.ts runAgent) and of the finished trace.
import type { Trace as TraceBase, ChangeView } from '../../chart/trace.ts';
import type { BenchmarkResult } from '../../chart/api.ts';
import type { ReplyResult } from '../../chart/reply.ts';

export interface ToolCallInfo { id: string; name: string; arguments: unknown }
export interface AssistantStepEvent {
  type: 'assistant'; turn: number; seconds: number; finish_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  reasoning: string; content: string; tool_calls: ToolCallInfo[];
}
export interface ToolStepEvent {
  type: 'tool'; turn: number; call: number; id: string; name: string; arguments: unknown;
  status: number | null; summary: string; plain: string; outcome: string; write: boolean; error: boolean; counted: boolean;
  ms: number; chars: number; truncated: boolean; content: string; refs?: string[];
}

/** The trace a run's `done` event carries. */
export interface RunTrace extends TraceBase {
  id: string;
  model: string;
  patient: string;
  prompt: string;
  stop_reason: string | null;
  error: string | null;
  turns: number;
  tool_calls: number;
  chart_requests: number;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  seconds: number | null;
  task: { id: string; family: string; suite: string; gold: string[] | null; gold_answer: unknown; skipped: string | null } | null;
  changes?: ChangeView[];
  benchmark?: BenchmarkResult;
}

export type StreamEvent =
  | { event: 'start'; trace: { id: string; model: string; prompt: string } }
  | { event: 'model_call'; turn: number }
  | { event: 'prefill'; turn: number; done: number; total: number }
  | { event: 'delta'; turn: number; kind: 'reasoning' | 'text'; text: string }
  | { event: 'step'; step: AssistantStepEvent | ToolStepEvent }
  | { event: 'done'; trace: RunTrace; reply?: 'pending' | null }
  | { event: 'reply_start' }
  | { event: 'reply_progress'; done: number; total: number }
  | { event: 'reply'; reply: ReplyResult }
  | { event: 'error'; error: string };
