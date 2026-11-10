// The reply turn's sentences (src/chart/reply.ts), above the answer card: a loader while LFM3
// writes them, then the text with each [Type/id] as a numbered link to its record. Shown only
// when the reply passed the checks; otherwise nothing (the developer view says why). The answer
// card below always stays.
import { Fragment } from 'react';
import { REF } from '../../chart/reply.ts';
import { DotMatrix } from './DotMatrix.tsx';
import { openRecord } from './hooks.ts';
import type { Run } from './run.ts';

/** The reply as text and citation links; adjacent citations sit together, after the words. */
function Cited({ text, refs }: { text: string; refs: string[] }) {
  const parts: (string | { ref: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(`\\[?${REF.source}\\]?`, 'g'))) {
    parts.push(text.slice(last, m.index));
    parts.push({ ref: `${m[1]}/${m[2]}` });
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <p className="text-[15px] leading-7">
      {parts.map((part, i) => typeof part === 'string'
        ? <Fragment key={i}>{part.replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ')}</Fragment>
        : (
          <button
            key={i} type="button" onClick={() => openRecord(part.ref)} title={`Open ${part.ref}`}
            className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded bg-muted px-1 align-middle font-medium text-[10px] text-muted-foreground tabular-nums outline-none hover:bg-muted-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {refs.indexOf(part.ref) + 1}
          </button>
        ))}
    </p>
  );
}

export function ReplyView({ run, dev }: { run: Run; dev: boolean }) {
  if (run.replyPending) {
    return (
      <div className="flex items-center gap-2.5 text-sm" aria-live="polite">
        <DotMatrix />
        <span className="shimmer text-foreground/80 motion-reduce:shimmer-none">Writing a summary</span>
      </div>
    );
  }
  const reply = run.reply;
  if (!reply) return null;
  if (reply.state === 'shown') {
    return (
      <div>
        <Cited text={reply.text} refs={reply.refs} />
      </div>
    );
  }
  if (!dev) return null;
  return (
    <details className="text-muted-foreground text-xs">
      <summary className="cursor-pointer">
        Summary withheld ({reply.state}{reply.problems.length ? `: ${reply.problems.join('; ')}` : ''}). The answer card shows the result.
      </summary>
      {reply.text ? <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted/60 p-2.5 text-foreground/80" data-reply-text>{reply.text}</p> : null}
    </details>
  );
}
