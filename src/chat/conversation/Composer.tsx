// The question box (AI Elements Chat look): a filled box with no border and no ring in any state.
// Ask mode: an auto-growing textarea (Enter sends, Shift+Enter a new line). Benchmark mode: the
// chosen benchmark question (SHELL's BenchmarkQuestion). Bottom row: the Ask / Benchmark switch
// and the round send button, which turns into Stop while a run streams.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpIcon, FlaskConicalIcon, MessageSquareIcon, SquareIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { app, setMode } from '../../app/state.ts';
import type { Mode } from '../../app/state.ts';
import { sentQuestion } from '../benchmark/logic.ts';
import { BenchmarkQuestion } from '../benchmark/BenchmarkQuestion.tsx';
import { useApp } from '../store.ts';
import { ask, stop } from './run.ts';

export const firstName = (): string => (app.patient?.name ?? '').split(/\s+/)[0] || 'this patient';

const MODES: [Mode, string, ReactNode][] = [
  ['ask', 'Ask', <MessageSquareIcon key="a" />],
  ['benchmark', 'Benchmark', <FlaskConicalIcon key="b" />],
];

/** Why the send button is off, or '' when a question can be sent. */
function blocked(text: string): string {
  if (app.model.state !== 'ready') return 'Load the model to ask';
  if (!app.patient) return 'Choose a patient first';
  if (app.mode === 'ask' && !text.trim()) return 'Type a question';
  if (app.mode === 'benchmark' && !app.question) return 'Choose a benchmark question';
  return '';
}

export function send(text: string): boolean {
  if (app.busy || blocked(text)) return false;
  if (app.mode === 'benchmark') {
    const q = app.question!;
    void ask(q.prompt, { label: q.label, family: q.family });
    sentQuestion(q.id);  // the thread shows it now; the composer offers the next one
  } else {
    void ask(text, null);
  }
  return true;
}

export function Composer({ text, setText, className, autoFocus }: { text: string; setText: (t: string) => void; className?: string; autoFocus?: boolean }) {
  useApp(['mode', 'question', 'model', 'busy', 'patient']);
  const input = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, 1 to 8 lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const max = line * 8;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text, app.mode]);
  useEffect(() => { if (autoFocus && window.matchMedia('(min-width: 768px)').matches) input.current?.focus(); }, [autoFocus]);

  const submit = () => {
    if (send(text) && app.mode === 'ask') setText('');
  };
  const reason = app.busy ? '' : blocked(text);
  const benchmark = app.mode === 'benchmark';

  const button = app.busy ? (
    <button type="button" onClick={stop} aria-label="Stop the run"
      className="flex size-8 items-center justify-center rounded-full bg-foreground text-background outline-none transition-colors hover:bg-foreground/85 focus-visible:ring-2 focus-visible:ring-ring/60">
      <SquareIcon className="size-3 fill-current" />
    </button>
  ) : (
    <button type="submit" disabled={!!reason} aria-label={reason || (benchmark ? 'Run the benchmark question' : 'Send')}
      className="flex size-8 items-center justify-center rounded-full bg-foreground text-background outline-none transition-colors hover:bg-foreground/85 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:bg-muted-foreground/30 disabled:text-background">
      <ArrowUpIcon className="size-4" strokeWidth={2.25} />
    </button>
  );

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className={cn('w-full rounded-3xl bg-muted transition-colors dark:bg-muted', className)}
      aria-label="Ask about the chart"
    >
      {/* Both modes share a fixed viewport; the mode controls stay in one place. */}
      <div className="h-40 overflow-y-auto overscroll-contain sm:h-36">
      {benchmark ? (
        <BenchmarkQuestion className="px-4 pt-3.5" />
      ) : (
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          placeholder={`Ask about ${firstName()}'s chart`}
          aria-label="Question about the chart"
          enterKeyHint="send"
          className="block w-full resize-none border-0 bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
        />
      )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-2.5">
        <div className="flex items-center gap-0.5" role="group" aria-label="Question mode">
          {MODES.map(([mode, label, icon]) => (
            <button key={mode} type="button" aria-pressed={app.mode === mode} disabled={app.busy} onClick={() => setMode(mode)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 [&_svg]:size-3.5',
                app.mode === mode ? 'bg-background text-foreground shadow-xs dark:bg-foreground/10' : 'text-muted-foreground hover:text-foreground',
              )}>
              {icon}{label}
            </button>
          ))}
        </div>
        {reason ? (
          <Tooltip>
            <TooltipTrigger asChild><span tabIndex={0} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{button}</span></TooltipTrigger>
            <TooltipContent side="top">{reason}</TooltipContent>
          </Tooltip>
        ) : button}
      </div>
    </form>
  );
}
