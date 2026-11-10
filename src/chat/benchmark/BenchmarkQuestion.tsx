// The benchmark question inside the composer (benchmark mode, in place of the textarea): one muted
// caption line, the exact prompt in two lines, and small icon buttons (Shuffle, Next, Browse,
// Clear). No background or border of its own: it sits inside the composer's filled box.
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ListFilter, Shuffle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { app } from '../../app/state.ts';
import type { ChosenQuestion } from '../../app/state.ts';
import { announce, cap } from '../../app/dom.ts';
import type { QuestionRow } from '../../chart/data.ts';
import { activeFilters, bench, clearQuestion, next, premiseOf, retry, shuffle, STYLE, WORDING, wording } from './logic.ts';
import { useBench } from './useBench.ts';
import { QuestionTags } from './QuestionBrowser.tsx';
import { isMac, openQuestionBrowser } from '../shell/Shortcuts.tsx';

/** "Latest lab value · Physician · typos" plus the warning words ("writes", "false premise"). */
export function QuestionCaption({ q, className }: { q: QuestionRow; className?: string }) {
  const natural = !!bench.index?.some((x) => x.persona);
  const parts = [cap(q.label), natural ? WORDING[wording(q)] ?? cap(wording(q)) : cap(q.task_type)];
  if (q.style && q.style !== 'clean') parts.push((STYLE[q.style] ?? q.style).toLowerCase());
  return (
    <div className={cn('flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground', className)}>
      <span className="truncate">{parts.join(' · ')}</span>
      {premiseOf(q) === 'false' && <><span aria-hidden="true">·</span><span className="text-warning">false premise</span></>}
      {!q.read_only && <><span aria-hidden="true">·</span><span className="text-warning" title="Answering it changes the chart (a private copy in this browser)">writes</span></>}
      <QuestionTags r={q} />
    </div>
  );
}

function IconAction({ label, onClick, children, disabled, badge }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; badge?: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button" variant="ghost" size="icon-sm" aria-label={badge ? `${label} (${badge} ${badge === 1 ? 'filter' : 'filters'} on)` : label}
          disabled={disabled} onClick={onClick}
          className="relative size-7 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/10"
        >
          {children}
          {!!badge && <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-brand" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function BenchmarkQuestion({ className }: { className?: string }) {
  const b = useBench();
  const q = app.question;
  const busy = app.busy;
  const filtersOn = activeFilters().length;

  const doShuffle = () => { void shuffle().then((said) => { if (said) announce(said); }); };
  const nextBtn = <IconAction label="Next (this patient)" onClick={() => void next()} disabled={busy}><ArrowRight /></IconAction>;
  const shuffleBtn = <IconAction label="Shuffle (any patient)" onClick={doShuffle} disabled={busy}><Shuffle /></IconAction>;
  // The one entry to the benchmark browser: labelled, since it is how to find a question by specialty, difficulty, who asks, …
  const browseBtn = (
    <IconAction label={`Browse questions (${isMac ? '⌘K' : 'Ctrl+K'})`} onClick={openQuestionBrowser} disabled={busy} badge={filtersOn}>
      <ListFilter />
    </IconAction>
  );
  // The question's actions, kept small at the top right of the block instead of a row of their own.
  const actions = (withNext: boolean, withClear: boolean) => (
    <div className="-mt-1 -mr-1.5 flex shrink-0 items-center" role="group" aria-label="Question actions">
      {shuffleBtn}{withNext && nextBtn}{browseBtn}
      {withClear && <IconAction label="Clear" onClick={clearQuestion} disabled={busy}><X /></IconAction>}
    </div>
  );
  const note = b.note ? <p role="status" className="mt-1 text-xs text-muted-foreground">{b.note}</p> : null;

  // ---- errors ----
  const error = !q && (b.indexError ? `Could not load the benchmark questions: ${b.indexError}` : b.pickError ? `Could not choose a question: ${b.pickError}` : null);
  if (error) {
    return (
      <div className={cn('px-1', className)}>
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <button type="button" onClick={retry} className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Try again</button>
      </div>
    );
  }

  // ---- loading ----
  if (!q && (b.picking || (!b.cleared && (!b.index || !app.patient)))) {
    return (
      <div className={cn('space-y-2 px-1 py-0.5', className)} aria-busy="true">
        <div className="h-3 w-40 animate-pulse rounded bg-foreground/[0.07]" />
        <div className="h-4 w-full animate-pulse rounded bg-foreground/[0.07]" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-foreground/[0.07]" />
        <span className="sr-only">Choosing a benchmark question…</span>
      </div>
    );
  }

  // ---- cleared ----
  if (!q) {
    return (
      <div className={cn('px-1', className)}>
        <div className="flex items-center gap-1">
          <span className="mr-auto text-sm text-muted-foreground">No question chosen</span>
          {actions(true, false)}
        </div>
        {note}
      </div>
    );
  }

  return (
    <div className={cn('min-w-0 px-1', className)} role="group" aria-label="Benchmark question">
      <div className="flex items-start gap-2">
        <QuestionCaption q={q} className="min-w-0 flex-1 pt-0.5" />
        {actions(true, true)}
      </div>
      <Prompt key={q.id} q={q} />
      {note}
    </div>
  );
}

/** The prompt's question, clamped to two lines ("more" when longer). The answer contract the
 *  benchmark appends ("Reply with only JSON: …") is sent unchanged but shown only on request. */
function Prompt({ q }: { q: ChosenQuestion }) {
  const text = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const [format, setFormat] = useState(false);
  const cut = q.prompt.search(/\n\s*Reply with only JSON/);
  const asked = cut >= 0 ? q.prompt.slice(0, cut).trim() : q.prompt;
  const contract = cut >= 0 ? q.prompt.slice(cut).trim() : '';
  useLayoutEffect(() => {
    const el = text.current;
    if (!el || open) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, q.prompt]);
  return (
    <div className="mt-1">
      <p
        ref={text}
        className={cn('text-[15px] leading-6 break-words whitespace-pre-wrap', open ? 'max-h-48 overflow-y-auto' : 'line-clamp-2')}
      >
        {asked}
      </p>
      <div className="flex gap-3 text-xs text-muted-foreground">
        {(long || open) && (
          <button
            type="button" aria-expanded={open} onClick={() => setOpen(!open)}
            className="underline-offset-4 hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {open ? 'less' : 'more'}
          </button>
        )}
        {contract && (
          <button
            type="button" aria-expanded={format} onClick={() => setFormat(!format)}
            className="underline-offset-4 hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {format ? 'hide answer format' : 'answer format'}
          </button>
        )}
      </div>
      {format && <p className="mt-1 max-h-32 overflow-y-auto rounded-md bg-foreground/[0.05] px-2 py-1.5 font-mono text-[11.5px] leading-5 break-words whitespace-pre-wrap text-muted-foreground">{contract}</p>}
    </div>
  );
}
