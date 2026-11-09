// The conversation column: patient and chart toggle on top, then either the empty state (greeting,
// the question box front and centre, three ways in) or the thread of runs with the question box
// at the bottom. Threads are kept per patient in memory (run.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import {
  Conversation as Thread, ConversationContent, ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { ArrowUpRight, Shuffle } from 'lucide-react';
import { sampleSuggestions, suggestionTitle } from './suggestions.ts';
import type { Suggestion } from './suggestions.ts';
import { cn } from '@/lib/utils';
import { app, setMode } from '../../app/state.ts';
import { storage } from '../../app/dom.ts';
import { PatientSwitcherButton } from '../shell/PatientSwitcher.tsx';
import { ChartToggle } from '../shell/ChartToggle.tsx';
import { ModelCard } from '../model/ModelCard.tsx';
import { useApp, useEvent } from '../store.ts';
import { Composer, firstName, send } from './Composer.tsx';
import { suggestionsFor, useThread } from './hooks.ts';
import { RunView } from './RunView.tsx';

const VOICES = [['physician', 'Physician'], ['nurse', 'Nurse'], ['clerical', 'Front desk']] as const;
type Voice = (typeof VOICES)[number][0];
const savedVoice = storage.get<string>('voice', 'physician');

/** Pick a fresh set on each visit/patient/voice change; preserve it across mode switches. */
function useSuggestions(patient: string | undefined, voice: Voice) {
  const [state, setState] = useState<{ key: string; pool: Suggestion[]; list: Suggestion[] } | null>(null);
  const key = `${patient} ${voice}`;
  useEffect(() => {
    if (!patient) return;
    let live = true;
    void suggestionsFor(patient).then((all) => {
      const pool = all.filter(s => s.voice === voice);
      if (live) setState({ key, pool, list: sampleSuggestions(pool) });
    });
    return () => { live = false; };
  }, [patient, voice, key]);
  const current = state?.key === key ? state : null;
  const shuffle = () => setState(prev => prev?.key === key ? { ...prev, list: sampleSuggestions(prev.pool, prev.list) } : prev);
  return { list: current?.list ?? null, shuffle, canShuffle: (current?.pool.length ?? 0) > 3 };
}

function EmptyState({ text, setText }: { text: string; setText: (t: string) => void }) {
  useApp(['mode', 'model', 'patient', 'ready']);
  const [voice, setVoice] = useState<Voice>(VOICES.some(([v]) => v === savedVoice) ? (savedVoice as Voice) : 'physician');
  const { list, shuffle, canShuffle } = useSuggestions(app.patient?.id, voice);
  const benchmark = app.mode === 'benchmark';
  const pick = (v: Voice) => { setVoice(v); storage.set('voice', v); };
  const choose = (q: string) => {
    setText(q);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Question about the chart"]');
      el?.focus();
      el?.setSelectionRange(q.length, q.length);
    });
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 pt-6 pb-[12vh] sm:px-6">
        <div className="animate-in fade-in-0 slide-in-from-bottom-1 text-center duration-300">
          <h1 className="font-semibold text-2xl tracking-tight sm:text-[1.75rem]">What would you like to know about {firstName()}?</h1>
          <p className="mx-auto mt-2 min-h-12 max-w-md text-muted-foreground text-sm leading-6">
            {benchmark ? 'Run the question below, or shuffle for another.' : 'A 1.7B model reads this synthetic chart with FHIR searches, privately on this device.'}
          </p>
        </div>
        <ModelCard className="mx-auto mt-6 w-full max-w-xl" />
        <Composer text={text} setText={setText} autoFocus className="mt-7 animate-in fade-in-0 duration-300" />
        {/* Reserve the same space in Benchmark, including while suggestions load. */}
        <section inert={benchmark} aria-hidden={benchmark || undefined}
          className={cn('mt-5', benchmark && 'invisible')} aria-label="Suggested questions">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5 rounded-full bg-muted/50 p-1" role="group" aria-label="Who is asking">
              {VOICES.map(([v, label]) => (
                <button key={v} type="button" aria-pressed={voice === v} onClick={() => pick(v)}
                  className={cn('min-h-10 rounded-full px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50', voice === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={shuffle} disabled={!canShuffle} aria-label="Shuffle suggested questions"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40">
              <Shuffle className="size-3.5" aria-hidden="true" /> Shuffle
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[0, 1, 2].map(i => {
              const item = list?.[i];
              return item ? (
                <button key={i} type="button" onClick={() => choose(item.question)} title={item.question}
                  aria-label={`${suggestionTitle(item)}: ${item.question}`}
                  className="group flex h-24 min-w-0 flex-col gap-2 rounded-2xl bg-muted/40 p-3.5 text-left shadow-sm ring-1 ring-inset ring-foreground/5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 sm:h-32">
                  <span className="flex w-full items-center justify-between gap-2 text-xs font-medium text-foreground">
                    <span className="truncate">{suggestionTitle(item)}</span>
                    <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-muted-foreground sm:line-clamp-3">{item.question}</span>
                </button>
              ) : <div key={i} className="h-24 rounded-2xl bg-muted/30 sm:h-32" aria-hidden="true" />;
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Scroll to the newest run when one is added (even if the reader had scrolled up). */
function FollowNewRuns({ count }: { count: number }) {
  const { scrollToBottom } = useStickToBottomContext();
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current) void scrollToBottom('smooth');
    seen.current = count;
  }, [count, scrollToBottom]);
  return null;
}

export function Conversation() {
  useApp(['patient', 'ready']);
  const patient = app.patient?.id;
  const runs = useThread(patient);
  const [text, setText] = useState('');

  const compose = useCallback(({ text: t, send: now }: { text: string; send?: boolean }) => {
    if (app.busy) return;
    setMode('ask');
    setText(t);
    if (now && send(t)) setText('');
  }, []);
  useEvent('compose', compose);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-background px-3 py-2 sm:px-4">
        <PatientSwitcherButton />
        <ChartToggle />
      </header>
      {!runs.length ? (
        <EmptyState text={text} setText={setText} />
      ) : (
        <>
          <Thread key={patient} className="min-h-0" initial="instant">
            <ConversationContent className="mx-auto w-full max-w-3xl gap-12 px-4 pt-10 pb-12 sm:px-6">
              {runs.map((run) => <RunView key={run.id} run={run} />)}
            </ConversationContent>
            <FollowNewRuns count={runs.length} />
            {/* Soft edges: the thread fades out under the header and above the composer instead of a hard cut. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-10 bg-gradient-to-b from-background to-transparent" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-10 bg-gradient-to-t from-background to-transparent" />
            <ConversationScrollButton className="bottom-3 z-10 size-8 bg-background shadow-sm" />
          </Thread>
          <div className="px-3 pb-3 sm:px-4 sm:pb-4">
            <Composer text={text} setText={setText} autoFocus className="mx-auto max-w-3xl animate-in fade-in-0 slide-in-from-bottom-4 duration-200" />
          </div>
        </>
      )}
    </div>
  );
}
