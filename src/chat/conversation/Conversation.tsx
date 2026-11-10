// The conversation column: patient and chart toggle on top, then either the empty state (greeting,
// the question box front and centre, three ways in) or the thread of runs with the question box
// at the bottom. Threads are kept per patient in memory (run.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import {
  Conversation as Thread, ConversationContent, ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { cn } from '@/lib/utils';
import { app, setMode } from '../../app/state.ts';
import { storage } from '../../app/dom.ts';
import { PatientSwitcherButton } from '../shell/PatientSwitcher.tsx';
import { ChartToggle } from '../shell/ChartToggle.tsx';
import { ModelCard } from '../model/ModelCard.tsx';
import { useApp, useEvent } from '../store.ts';
import { Composer, firstName, send } from './Composer.tsx';
import { useThread } from './hooks.ts';
import { RunView } from './RunView.tsx';
import { SuggestionRows, useSuggestionPool } from './SuggestionRows.tsx';

const VOICES = [['physician', 'Physician'], ['nurse', 'Nurse'], ['clerical', 'Front desk']] as const;
type Voice = (typeof VOICES)[number][0];
const savedVoice = storage.get<string>('voice', 'physician');

function EmptyState({ text, setText }: { text: string; setText: (t: string) => void }) {
  useApp(['mode', 'model', 'patient', 'ready']);
  const [voice, setVoice] = useState<Voice>(VOICES.some(([v]) => v === savedVoice) ? (savedVoice as Voice) : 'physician');
  const list = useSuggestionPool(app.patient?.id, voice);
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
      {/* Anchored from the top, not centred: the composer grows downward and nothing above it moves. */}
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-[max(1.5rem,14vh)] pb-12 sm:px-6">
        <div className="animate-in fade-in-0 slide-in-from-bottom-1 text-center duration-300">
          <h1 className="font-semibold text-2xl tracking-tight sm:text-[1.75rem]">What would you like to know about {firstName()}?</h1>
          <p className="mx-auto mt-2 min-h-12 max-w-md text-muted-foreground text-sm leading-6">
            {benchmark ? 'Run the question below, or shuffle for another.' : 'Explore this synthetic chart with an AI assistant that runs privately on your device.'}
          </p>
        </div>
        <ModelCard className="mx-auto mt-6 w-full max-w-xl" />
        <Composer text={text} setText={setText} autoFocus className="mt-7 animate-in fade-in-0 duration-300" />
        {!benchmark ? (
          <div className="mt-6 flex flex-col items-center gap-3 animate-in fade-in-0 duration-500">
            {list ? <SuggestionRows key={`${app.patient?.id} ${voice}`} list={list} onChoose={choose} /> : <div className="h-[4.75rem]" aria-hidden="true" />}
            {list && !list.length ? <p className="text-muted-foreground text-sm">No suggestion fits this chart. Ask anything.</p> : null}
            <div className="flex items-center gap-1 text-xs" role="group" aria-label="Who is asking">
              {VOICES.map(([v, label], i) => (
                <span key={v} className="flex items-center gap-1">
                  {i ? <span aria-hidden="true" className="text-muted-foreground/50">·</span> : null}
                  <button type="button" aria-pressed={voice === v} onClick={() => pick(v)}
                    className={cn('rounded-sm px-1 py-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50', voice === v ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {label}
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
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
