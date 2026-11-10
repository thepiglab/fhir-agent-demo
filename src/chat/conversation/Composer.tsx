// The question box (AI Elements Chat look): a filled box with no border and no ring in any state.
// Ask mode: an auto-growing textarea (Enter sends, Shift+Enter a new line). Benchmark mode: the
// chosen benchmark question (SHELL's BenchmarkQuestion). Bottom row: the Ask / Benchmark switch
// and the round send button, which turns into Stop while a run streams.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<{ px: number; grow: boolean } | null>(null);
  // One row (mode switch, text, send) until the text needs a second line; then the text gets its
  // own row above the controls, as in ChatGPT. Back to one row once the box is empty again.
  const [grown, setGrown] = useState(false);
  const benchmark = app.mode === 'benchmark';
  const expanded = benchmark || grown;

  // Grow with the text, 1 to 8 lines. Re-measured when the text changes and when the box's width
  // changes (a measure taken mid-layout at a narrow width must not stick); an empty box is one line.
  const measure = useRef<() => void>(() => {});
  measure.current = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 24;
    const max = line * 8;
    if (!text) {
      if (grown) setGrown(false);
      el.style.height = `${line + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)}px`;
      el.style.overflowY = 'hidden';
      return;
    }
    if (!grown && (el.scrollHeight > line * 1.5 || text.includes('\n'))) setGrown(true);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  };
  useLayoutEffect(() => measure.current(), [text, app.mode, grown]);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; measure.current(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [app.mode]);
  // The box animates to its content's height (mode switch, growing to two rows, a new question).
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    // Growing animates; shrinking snaps, so switching back to Ask shows the new state at once.
    const ro = new ResizeObserver(() => setHeight((h) => ({ px: el.offsetHeight, grow: !!h && el.offsetHeight > h.px })));
    ro.observe(el);
    setHeight({ px: el.offsetHeight, grow: false });
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (autoFocus && window.matchMedia('(min-width: 768px)').matches) input.current?.focus(); }, [autoFocus]);

  // Benchmark mode has no textarea, so Enter needs an explicit shortcut.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (app.mode !== 'benchmark' || event.defaultPrevented || event.key !== 'Enter' ||
          event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) return;
      // Dialogs own Enter (including the question picker); other controls retain
      // their native activation. The selected Benchmark mode button can send.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest('button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="tab"], [role="menuitem"], [role="option"]');
      if (control && !control.matches('[data-benchmark-mode][aria-pressed="true"]')) return;
      event.preventDefault();
      send(''); // Reuses model-ready, patient, selected-question and busy guards.
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = () => {
    if (send(text) && app.mode === 'ask') setText('');
  };
  const reason = app.busy ? '' : blocked(text);

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
      className={cn('w-full overflow-hidden rounded-[1.75rem] bg-muted dark:bg-muted', height?.grow && 'transition-[height] duration-200 ease-out motion-reduce:transition-none', className)}
      style={height === null ? undefined : { height: height.px }}
      aria-label="Ask about the chart"
    >
      <div
        ref={inner}
        className={cn(
          'grid gap-x-1 p-2',
          expanded
            ? "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'text_text'_'modes_send']"
            : "grid-cols-[auto_minmax(0,1fr)_auto] items-center [grid-template-areas:'modes_text_send']",
        )}
      >
      <div className={cn('[grid-area:text] min-w-0', expanded && 'max-h-[min(20rem,45vh)] overflow-y-auto overscroll-contain')}>
      {benchmark ? (
        <BenchmarkQuestion className="px-2 pt-1.5 pb-1" />
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
          className={cn(
            'block w-full resize-none border-0 bg-transparent text-[15px] leading-6 shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
            expanded ? 'px-2 pt-1.5 pb-2' : 'px-2 py-1',
          )}
        />
      )}
      </div>
        <div className="[grid-area:modes] flex items-center gap-0.5 self-end" role="group" aria-label="Question mode">
          {MODES.map(([mode, label, icon]) => (
            <button key={mode} type="button" data-benchmark-mode={mode === 'benchmark' ? '' : undefined} aria-pressed={app.mode === mode} aria-label={label} disabled={app.busy} onClick={() => setMode(mode)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 [&_svg]:size-3.5',
                app.mode === mode ? 'bg-background text-foreground shadow-xs dark:bg-foreground/10' : 'text-muted-foreground hover:text-foreground',
              )}>
              {icon}<span className={cn(!expanded && 'max-[480px]:hidden')}>{label}</span>
            </button>
          ))}
        </div>
        <div className="[grid-area:send] self-end">
        {reason ? (
          <Tooltip>
            <TooltipTrigger asChild><span tabIndex={0} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{button}</span></TooltipTrigger>
            <TooltipContent side="top">{reason}</TooltipContent>
          </Tooltip>
        ) : button}
        </div>
      </div>
    </form>
  );
}
