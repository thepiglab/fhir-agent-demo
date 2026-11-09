// The answer of a finished run, as generative UI: a stat, a trend card, key/value fields, data
// tables (cards on narrow screens) or prose; values underlined to the records that state them;
// one verification line; what the run changed; and a Sources line.
import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import { CheckIcon, CircleAlertIcon, InfoIcon } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceLine, TraceTitle,
} from '@/components/ui/trace';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';
import { cap, fmtDate, plural } from '../../app/dom.ts';
import { typeNoun } from '../../app/state.ts';
import type { ChangeView, ToolStep } from '../../chart/trace.ts';
import { answerRefs, context, isDate, plan } from './answer.ts';
import type { Block, Ctx, FieldsBlock, ListBlock, StatBlock, TableBlock } from './answer.ts';
import { openRecord, useRecords } from './hooks.ts';
import { TrendChart } from './TrendChart.tsx';
import { Cited, Value, withUnit } from './values.tsx';
import type { RunTrace } from './types.ts';

// ---------- blocks ----------
function statText(block: StatBlock, ctx: Ctx): ReactNode {
  const v = block.value;
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))) return withUnit(v, block.unit);
  return <Value value={v} ctx={ctx} />;
}
function Stat({ block, ctx }: { block: StatBlock; ctx: Ctx }) {
  const long = typeof block.value === 'string' && block.value.length > 48 && !isDate(block.value);
  if (long) return <p className="text-[15px] leading-7"><Cited path={block.path} ctx={ctx}>{String(block.value)}</Cited></p>;
  return (
    <div>
      {block.label ? <p className="text-muted-foreground text-sm">{block.label}</p> : null}
      <p className="mt-1 font-semibold text-3xl tabular-nums tracking-tight">
        <Cited path={block.path} ctx={ctx}>{statText(block, ctx)}</Cited>
      </p>
      {block.sub.length ? <p className="mt-1.5 text-muted-foreground text-sm">{block.sub.map((s) => (isDate(s) ? fmtDate(s) : s)).join(' · ')}</p> : null}
      {block.range ? (
        <p className="mt-1 text-muted-foreground text-sm" data-range>
          {block.flag ? <span className="font-medium text-warning">{block.flag === 'low' ? 'Below' : 'Above'} the reference range · </span> : null}
          Reference range {block.range}
        </p>
      ) : null}
      {block.extra.length ? (
        <p className="mt-1 text-muted-foreground text-sm">
          {block.extra.map(([k, v], i) => <span key={k}>{i ? ' · ' : ''}{k.replace(/_/g, ' ')} <Value value={v} ctx={ctx} /></span>)}
        </p>
      ) : null}
    </div>
  );
}

function Fields({ block, ctx }: { block: FieldsBlock; ctx: Ctx }) {
  return (
    <dl className="divide-y border-y text-[15px]">
      {block.rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-6 py-2.5">
          <dt className="shrink-0 text-muted-foreground text-sm">{row.label}</dt>
          <dd className="min-w-0 text-right font-medium tabular-nums">
            <Cited path={row.path} ctx={ctx}><Value value={row.value} ctx={ctx} /></Cited>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Cell({ item, col, ctx }: { item: Record<string, unknown>; col: string; ctx: Ctx }): ReactNode {
  const v = item[col];
  if (col === 'value' && typeof item.unit === 'string' && (typeof v === 'number' || typeof v === 'string')) return withUnit(v, item.unit);
  return <Value value={v} ctx={ctx} />;
}

function Table({ block, ctx }: { block: TableBlock; ctx: Ctx }) {
  const [lead, ...rest] = block.columns;
  const numeric = (key: string) => key === 'value' || block.rows.every((r) => typeof r.item[key] === 'number');
  return (
    <section className="@container">
      {block.title ? (
        <h3 className="mb-2 font-medium text-sm">
          {block.title} <span className="font-normal text-muted-foreground">· {block.rows.length}</span>
        </h3>
      ) : null}
      {/* Wide: a table with a muted header and hairline rows. */}
      <div className="hidden overflow-x-auto @md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              {block.columns.map((c) => <th key={c.key} className={cn('py-2 pr-4 font-normal last:pr-0', numeric(c.key) ? 'text-right' : 'text-left')}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {block.rows.map((row) => (
              <tr key={JSON.stringify(row.path)}>
                {block.columns.map((c, i) => (
                  <td key={c.key} className={cn('py-2.5 pr-4 align-top last:pr-0', numeric(c.key) && 'text-right tabular-nums', i === 0 ? 'font-medium' : 'text-foreground/90')}>
                    {i === 0 ? <Cited path={row.path} ctx={ctx}><Cell item={row.item} col={c.key} ctx={ctx} /></Cited> : <Cell item={row.item} col={c.key} ctx={ctx} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Narrow: stacked cards. */}
      <ul className="space-y-2 @md:hidden">
        {block.rows.map((row) => (
          <li key={JSON.stringify(row.path)} className="rounded-xl border bg-card px-4 py-3 text-sm">
            {lead ? <p className="font-medium"><Cited path={row.path} ctx={ctx}><Cell item={row.item} col={lead.key} ctx={ctx} /></Cited></p> : null}
            <dl className="mt-1 space-y-0.5">
              {rest.map((c) => (
                <div key={c.key} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd className="text-right tabular-nums"><Cell item={row.item} col={c.key} ctx={ctx} /></dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function List({ block, ctx }: { block: ListBlock; ctx: Ctx }) {
  if (!block.items.length) {
    return <p className="text-[15px] leading-7">{block.title ? `No ${block.title.toLowerCase()}.` : 'None found.'}</p>;
  }
  return (
    <section>
      {block.title ? <h3 className="mb-2 font-medium text-sm">{block.title} <span className="font-normal text-muted-foreground">· {block.items.length}</span></h3> : null}
      <ul className="divide-y border-y text-[15px]">
        {block.items.map((it) => (
          <li key={JSON.stringify(it.path)} className="py-2.5"><Cited path={it.path} ctx={ctx}><Value value={it.value} ctx={ctx} /></Cited></li>
        ))}
      </ul>
    </section>
  );
}

function BlockView({ block, ctx }: { block: Block; ctx: Ctx }) {
  switch (block.kind) {
    case 'prose': return <MessageResponse>{block.text}</MessageResponse>;
    case 'stat': return <Stat block={block} ctx={ctx} />;
    case 'fields': return <Fields block={block} ctx={ctx} />;
    case 'table': return <Table block={block} ctx={ctx} />;
    case 'list': return <List block={block} ctx={ctx} />;
    case 'trend': return <TrendChart trend={block.trend} ctx={ctx} />;
  }
}

// ---------- verification ----------
type Tone = 'ok' | 'warn' | 'err' | 'none';
export function verdict(trace: RunTrace): { tone: Tone; text: string; note: string | null } {
  const v = trace.verification ?? { state: 'none', supporting: [], unchecked: [], patient: false };
  const n = v.supporting.length, m = v.unchecked.length;
  if (v.state === 'verified') return { tone: 'ok', text: `Checked against ${plural(n, 'record')} in the chart`, note: `Each cited record is in this chart and was read while answering${v.patient ? '; the patient was matched by MRN' : ''}.` };
  if (v.state === 'partial') return { tone: 'warn', text: `${n} of ${plural(n + m, 'cited record')} checked`, note: 'Some citations could not be checked: ' + v.unchecked.map((u) => `${u.ref} (${u.reason})`).join('; ') + '.' };
  if (v.state === 'unsupported') return { tone: 'warn', text: 'No supporting record cited', note: 'The answer does not point to a chart record that backs it. Check the steps before relying on it.' };
  if (v.state === 'not_found') return { tone: 'none', text: 'Not found in the chart', note: null };
  if (v.state === 'unreadable') return { tone: 'warn', text: 'Not checked', note: 'The reply was not in the expected answer format, so it is shown as written and its sources cannot be checked.' };
  const reason = trace.error ? trace.error
    : trace.stop_reason === 'max_turns' ? `Stopped after ${plural(trace.turns, 'model call')} without an answer.` : 'The run ended without an answer.';
  return { tone: 'err', text: 'No answer', note: reason };
}

function Verification({ trace }: { trace: RunTrace }) {
  const v = verdict(trace);
  if (v.tone === 'none') return null;
  const Icon = v.tone === 'ok' ? CheckIcon : CircleAlertIcon;
  const line = (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', v.tone === 'ok' ? 'text-muted-foreground' : v.tone === 'warn' ? 'text-warning' : 'text-destructive')}>
      <Icon className={cn('size-4', v.tone === 'ok' && 'text-success')} aria-hidden="true" />
      {v.text}
    </span>
  );
  if (!v.note) return line;
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <button type="button" className="w-fit rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{line}</button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 text-sm leading-6">{v.note}</HoverCardContent>
    </HoverCard>
  );
}

// ---------- not found ----------
function NotFound({ trace }: { trace: RunTrace }) {
  const searched = trace.steps.filter((s): s is ToolStep => s.type === 'tool' && !s.write).slice(0, 8);
  return (
    <div className="space-y-3">
      <p className="text-[15px] leading-7">I could not find this in the chart.</p>
      {searched.length ? (
        <div>
          <p className="mb-1 text-muted-foreground text-xs">What was searched</p>
          <ul className="space-y-1 text-muted-foreground text-sm">
            {searched.map((s) => <li key={s.call}>{s.plain}{s.outcome ? ` · ${s.outcome}` : ''}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------- changes ----------
/** The status a created record starts in, for the change line: "Created task Review result (requested)". */
function startStatus(change: ChangeView): string {
  if (change.method !== 'POST') return '';
  const f = change.fields.find((x) => x.field === 'status' || x.field === 'clinicalStatus');
  return f && typeof f.after === 'string' ? f.after : '';
}

function ChangeLine({ change }: { change: ChangeView }) {
  const started = startStatus(change);
  return (
    <li className="py-2.5" data-write="ok">
      <p className="text-[15px]">
        <span className="font-medium">{change.verb}</span> {change.noun}{' '}
        {change.exists ? (
          <button type="button" onClick={() => openRecord(change.ref)} className="rounded-sm underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50">
            {change.label || change.ref}
          </button>
        ) : <span>{change.label || change.ref}</span>}
        {started ? <span className="text-muted-foreground"> ({started.toLowerCase()})</span> : null}
      </p>
      {change.fields.length ? (
        <ul className="mt-1 space-y-0.5 text-muted-foreground text-sm">
          {change.fields.map((f) => (
            <li key={f.field}>
              {f.label}{' '}
              {f.before !== null && f.before !== undefined ? <><del className="decoration-destructive/60">{f.before || 'empty'}</del><span aria-hidden="true"> → </span></> : null}
              {f.after !== null && f.after !== undefined ? <ins className="text-foreground no-underline">{f.after || 'empty'}</ins> : <span>removed</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Changes({ trace }: { trace: RunTrace }) {
  const made = trace.changes ?? [], refused = trace.refused_changes ?? [];
  if (!made.length && !refused.length) return null;
  const where = trace.benchmark ? "Changed in this benchmark episode's copy of the chart" : 'Changed in your copy of the chart';
  return (
    <div className="space-y-2">
      {made.length ? (
        <section className="rounded-2xl border bg-card px-4 py-3">
          <h3 className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{where}</span>
            <span className="text-muted-foreground">{plural(made.length, 'change')}</span>
          </h3>
          <ul className="mt-1 divide-y">{made.map((c, i) => <ChangeLine key={`${c.ref}-${i}`} change={c} />)}</ul>
        </section>
      ) : null}
      {refused.length ? (
        // Always open: a write that failed is as important to read as one that worked.
        <section className="rounded-2xl border border-warning/40 bg-card px-4 py-3" data-write="failed">
          <h3 className="font-medium text-sm">{refused.length === 1 ? 'A change did not go through' : `${refused.length} changes did not go through`}</h3>
          <ul className="mt-1 divide-y">
            {refused.map((r) => (
              <li key={r.call} className="py-2.5 text-[15px]">
                <span className="font-medium text-warning">Write failed: {r.status === null || r.status === undefined ? 'not run' : r.status}</span>
                <span className="text-muted-foreground"> · {r.plain}{r.outcome ? ` · ${r.outcome}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---------- sources ----------
export function SourcesLine({ trace }: { trace: RunTrace }) {
  const rows = (trace.sources ?? []).filter((r) => r.cited);
  if (!rows.length) return null;
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine><TraceTitle>Sources</TraceTitle><TraceDescription>· {plural(rows.length, 'record')}</TraceDescription></TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ul className="space-y-1.5 text-sm">
            {rows.map((r) => (
              <li key={r.ref}>
                {r.exists ? (
                  <button type="button" onClick={() => openRecord(r.ref)} className="rounded-sm text-left text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                    {r.label || r.ref}
                  </button>
                ) : <span className="font-mono text-xs">{r.ref}</span>}
                <span className="text-muted-foreground">
                  {' · '}{[cap(typeNoun(r.type)), r.date ? fmtDate(r.date) : ''].filter(Boolean).join(' · ')}
                  {!r.calls.length ? ' · never read by the run' : ''}{r.exists ? '' : ' · not in the chart'}
                </span>
              </li>
            ))}
          </ul>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

// ---------- the answer ----------
export const AnswerView = memo(({ trace, patient }: { trace: RunTrace; patient: string }) => {
  const refs = useMemo(() => answerRefs(trace), [trace]);
  const records = useRecords(patient, refs);
  const ctx = useMemo(() => (records ? context(trace, records) : null), [trace, records]);
  const planned = useMemo(() => (ctx ? plan(trace, ctx) : []), [trace, ctx]);
  if (!ctx) return <div className="h-16" aria-hidden="true" />;
  const notFound = trace.verification?.state === 'not_found';
  // A write's reply is often just {"status": "success"}: the change itself is the answer, so say
  // "Done" plainly and let the changes card below carry the detail.
  const changed = (trace.changes ?? []).length;
  const statusOnly = changed > 0 && planned.length === 1 && planned[0]!.kind === 'stat'
    && (typeof planned[0]!.value === 'string' || typeof planned[0]!.value === 'boolean');
  const blocks = statusOnly ? [] : planned;
  const quietVerdict = changed > 0 && trace.verification?.state === 'unsupported';
  return (
    <div className="flex flex-col gap-5 animate-in fade-in-0 slide-in-from-bottom-1 duration-200" data-answer>
      {statusOnly ? (
        <p className="text-[15px] leading-7">Done. {changed === 1 ? 'One change was' : `${changed} changes were`} made to your copy of the chart.</p>
      ) : notFound ? <NotFound trace={trace} /> : blocks.map((b, i) => <BlockView key={i} block={b} ctx={ctx} />)}
      {!blocks.length && !notFound && !statusOnly ? (
        <p className="inline-flex items-center gap-1.5 text-muted-foreground text-sm"><InfoIcon className="size-4" />The reply had no answer to show.</p>
      ) : null}
      {quietVerdict ? null : <Verification trace={trace} />}
    </div>
  );
});
AnswerView.displayName = 'AnswerView';
