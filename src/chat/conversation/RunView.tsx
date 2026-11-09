// One run: the user's message, then the assistant's turn. While working, one Run-activity row (a
// dot-matrix loader and the current step in shimmer); when done, the same row reads "Worked for
// 14s · 3 searches ›" and holds the reasoning and the steps as Trace lines. The answer, the
// benchmark check, the changes and the sources stay outside it, then a quiet timing footer.
import { memo, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { CheckIcon, CircleAlertIcon, CopyIcon, DownloadIcon } from 'lucide-react';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceLine, TraceTitle,
} from '@/components/ui/trace';
import { cn } from '@/lib/utils';
import { announce, fmtNum, highlight, plural, prettyText } from '../../app/dom.ts';
import { isRef } from '../../app/state.ts';
import { useApp } from '../store.ts';
import { AnswerView, Changes, SourcesLine, verdict } from './AnswerView.tsx';
import { GradeCard } from './GradeCard.tsx';
import { openRecord, useRun } from './hooks.ts';
import { DotMatrix } from './DotMatrix.tsx';
import { ReplyView } from './ReplyView.tsx';
import type { CallView, Run, ThoughtView } from './run.ts';
import type { RunTrace } from './types.ts';

const secs = (s: number): string => (s < 10 ? `${s.toFixed(1)}s` : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);
const tokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 1 : 2).replace(/\.?0+$/, '')}k` : String(n));

/** Highlighted JSON whose Type/id strings open the record. */
function Json({ text }: { text: string }) {
  const onClick = (e: MouseEvent) => {
    const link = (e.target as Element).closest<HTMLElement>('[data-ref]');
    if (!link?.dataset.ref) return;
    e.preventDefault();
    openRecord(link.dataset.ref);
  };
  return (
    <pre onClick={onClick} className="max-h-80 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[12px] text-foreground leading-5 [&_.j-key]:text-brand [&_.j-lit]:text-brand/70 [&_.j-num]:text-warning [&_.j-str]:text-success [&_a]:underline [&_a]:underline-offset-2"
      dangerouslySetInnerHTML={{ __html: highlight(text, isRef) }} />
  );
}

// ---------- the user's message ----------
function UserMessage({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const long = !!run.bench && (run.question.length > 240 || run.question.split('\n').length > 3);
  return (
    <Message from="user">
      {run.bench ? <p className="px-1 text-muted-foreground text-xs">Benchmark · {run.bench.label}</p> : null}
      <MessageContent><div className={cn('whitespace-pre-wrap break-words', long && !open && 'line-clamp-3')}>{run.question}</div></MessageContent>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="rounded-sm px-1 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </Message>
  );
}

// ---------- steps ----------
function StepLine({ call, dev }: { call: CallView; dev: boolean }) {
  const r = call.result;
  const status = !r ? (call.skipped ? 'pending' : 'running') : r.error && r.write ? 'error' : undefined;
  const title = r ? r.plain || `${call.method} ${call.path}` : call.skipped ? `${call.method} ${call.path}` : call.method === 'GET' ? 'Searching the chart' : 'Updating the chart';
  const desc = r ? [r.outcome, !r.counted && !r.error ? 'did not reach the chart' : ''].filter(Boolean).join(' · ') : call.skipped ? 'not run' : '';
  // A long outcome (a validation error) goes on its own line under the step, wrapped and clamped,
  // instead of squeezing the title into a narrow column.
  const long = desc.length > 48;
  const line = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <TraceLine status={status}>
        <TraceTitle className="whitespace-normal">{title}</TraceTitle>
        {desc && !long ? <TraceDescription className={cn(r?.error && 'text-destructive/80')}>· {desc}</TraceDescription> : null}
      </TraceLine>
      {desc && long ? <span className={cn('line-clamp-2 pl-0 text-xs leading-5', r?.error ? 'text-destructive/80' : 'text-muted-foreground')}>{desc}</span> : null}
    </div>
  );
  if (!dev) return line;
  const args = call.args as Record<string, unknown> | null;
  const body = args && typeof args === 'object' && args.body && typeof args.body === 'object' ? args.body : null;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-3 text-xs">
        <div className="space-y-1.5">
          <p className="text-muted-foreground">Request · <span className="font-mono">{call.name}</span>{r ? ` · #${r.call}` : ''}</p>
          <p className="break-all font-mono text-foreground"><span className="font-semibold">{call.method}</span> {call.path || '(root)'}</p>
          {body ? <Json text={JSON.stringify(body, null, 2)} /> : null}
        </div>
        {r ? (
          <div className="space-y-1.5">
            <p className="text-muted-foreground">
              Response · <span className={cn(r.error ? 'text-destructive' : 'text-success')}>{r.status ?? 'error'}</span> · {r.ms} ms
              {r.truncated ? ` · showing ${fmtNum(r.content.length)} of ${fmtNum(r.chars)} characters (the model saw all)` : ''}
            </p>
            <Json text={prettyText(r.content)} />
          </div>
        ) : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** One turn's reasoning, placed just before the searches that turn made. */
function Thought({ thought, live }: { thought: ThoughtView; live: boolean }) {
  const text = thought.text.trim();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (live && box.current) box.current.scrollTop = box.current.scrollHeight; });
  if (!text) return null;
  const s = thought.ms / 1000;
  return (
    <TraceCollapsible defaultOpen={false}>
      <TraceCollapsibleTrigger>
        <TraceLine status={live ? 'running' : undefined}>
          <TraceTitle>{live ? 'Thinking' : 'Thought'}</TraceTitle>
          {!live && s >= 0.5 ? <TraceDescription>· {secs(s)}</TraceDescription> : null}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div ref={box} className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{text}</div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

type Step = { kind: 'thought'; thought: ThoughtView; live: boolean } | { kind: 'call'; call: CallView };
/** Each turn's thought, then the calls that turn made, in turn order. */
function steps(run: Run): Step[] {
  const turns = [...new Set([...run.thoughts.map((t) => t.turn), ...run.calls.map((c) => c.turn)])].sort((a, b) => a - b);
  const lastThought = run.thoughts.at(-1);
  return turns.flatMap((turn): Step[] => {
    const thought = run.thoughts.find((t) => t.turn === turn);
    return [
      ...(thought ? [{ kind: 'thought' as const, thought, live: run.thinking && thought === lastThought }] : []),
      ...run.calls.filter((c) => c.turn === turn).map((call) => ({ kind: 'call' as const, call })),
    ];
  });
}

/** The Run-activity row: live loader and step while working; "Worked for 14s · 3 searches" after. */
function Activity({ run, dev }: { run: Run; dev: boolean }) {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (run.finished) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [run.finished]);
  const hasSteps = run.calls.length > 0 || run.thoughts.some((t) => t.text.trim());
  const summary = run.summary();
  const label = run.finished
    ? <TraceLine><TraceTitle>Worked for {secs(run.seconds)}</TraceTitle>{summary ? <TraceDescription>· {summary}</TraceDescription> : null}</TraceLine>
    : (
      <TraceLine className="gap-2.5">
        <DotMatrix />
        <TraceTitle className="shimmer text-foreground/80 motion-reduce:shimmer-none" aria-live="polite">{run.phase}</TraceTitle>
        <TraceDescription className="tabular-nums">{Math.floor(run.seconds)}s</TraceDescription>
      </TraceLine>
    );
  if (!hasSteps) return <Trace><div>{label}</div></Trace>;
  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>{label}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace className="gap-2.5">
            {steps(run).map((item) => (item.kind === 'thought'
              ? <Thought key={`t${item.thought.turn}`} thought={item.thought} live={item.live} />
              : <StepLine key={item.call.id} call={item.call} dev={dev} />))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

// ---------- footer ----------
function Footer({ trace, answer, dev }: { trace: RunTrace; answer: React.RefObject<HTMLDivElement | null>; dev: boolean }) {
  const [copied, setCopied] = useState(false);
  const total = trace.usage.total_tokens;
  // The default view says how long it took and how many chart searches; the developer view adds
  // tool calls and tokens.
  const parts = dev
    ? [trace.seconds !== null ? secs(trace.seconds) : null, plural(trace.tool_calls, 'tool call'), total ? `${tokens(total)} tokens` : null].filter(Boolean)
    : [trace.seconds !== null ? secs(trace.seconds) : null, trace.chart_requests ? plural(trace.chart_requests, 'chart search', 'chart searches') : null].filter(Boolean);
  const copy = () => {
    const text = answer.current?.querySelector<HTMLElement>('[data-answer]')?.innerText.trim() || trace.final?.text || '';
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      announce('Answer copied.');
      setTimeout(() => setCopied(false), 1400);
    }, () => announce('Could not copy.'));
  };
  return (
    <div className="flex items-center gap-1 text-muted-foreground text-xs">
      <span className="tabular-nums">{parts.join(' · ')}</span>
      {trace.final ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy answer" className="ml-1 text-muted-foreground hover:text-foreground">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? 'Copied' : 'Copy answer'}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** A free-response prompt's question and the training-format context line appended to it. */
function splitContext(prompt: string): { question: string; context: string } {
  const at = prompt.search(/\nContext: (patient MRN|known patient) /);
  return at < 0 ? { question: prompt, context: '' } : { question: prompt.slice(0, at), context: prompt.slice(at + 1) };
}

function DevDetails({ run, trace }: { run: Run; trace: RunTrace | null }) {
  const download = () => {
    if (!trace) return;
    const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fhir-demo-trace-${trace.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger><TraceLine><TraceTitle>Prompt and raw reply</TraceTitle></TraceLine></TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-3 text-xs">
          {(trace?.final?.warnings ?? []).map((w) => <p key={w} className="text-warning">{w}</p>)}
          {trace ? <p>{plural(trace.turns, 'model call')} · {trace.chart_requests} chart requests · {String(trace.stop_reason ?? '').replace('_', ' ')}</p> : null}
          <p className="text-muted-foreground">Message sent to the model</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 font-mono text-[12px] text-foreground leading-5">{splitContext(run.prompt).question || '…'}</pre>
          {splitContext(run.prompt).context ? (
            <p className="text-muted-foreground">
              Plus the patient-context line the model was trained with, kept out of the conversation:{' '}
              <span className="font-mono text-[11px]">{splitContext(run.prompt).context}</span>
            </p>
          ) : null}
          {trace?.final ? <><p className="text-muted-foreground">Raw reply</p><Json text={prettyText(trace.final.text)} /></> : null}
          {trace ? <Button variant="ghost" size="xs" onClick={download}><DownloadIcon />Download trace</Button> : null}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

// ---------- the run ----------
export const RunView = memo(({ run }: { run: Run }) => {
  useRun(run);
  const { dev } = useApp(['dev']);
  const node = useRef<HTMLDivElement>(null);
  const trace = run.trace;
  return (
    <article className="flex flex-col gap-6" aria-label={`Question: ${run.question.slice(0, 80)}`}>
      <UserMessage run={run} />
      <Message from="assistant">
        <MessageContent className="gap-5" ref={node}>
          <Activity run={run} dev={dev} />
          {run.state === 'stopped' ? <p className="text-muted-foreground text-sm">Stopped before it answered.</p> : null}
          {run.state === 'failed' ? (
            <p className={cn('flex items-start gap-1.5 text-sm', run.tooLong ? 'text-warning' : 'text-destructive')} role="alert">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />{run.error || 'Something went wrong.'}
            </p>
          ) : null}
          {trace && !trace.final && run.state === 'done' ? <p className="text-muted-foreground text-sm">No answer. {verdict(trace).note}</p> : null}
          {trace && trace.final ? <ReplyView run={run} dev={dev} /> : null}
          {trace && trace.final ? <AnswerView trace={trace} patient={run.patient} /> : null}
          {trace ? <GradeCard trace={trace} /> : null}
          {trace ? <Changes trace={trace} /> : null}
          {trace ? <SourcesLine trace={trace} /> : null}
          {dev && run.finished ? <DevDetails run={run} trace={trace} /> : null}
          {trace ? <Footer trace={trace} answer={node} dev={dev} /> : null}
        </MessageContent>
      </Message>
    </article>
  );
});
RunView.displayName = 'RunView';
