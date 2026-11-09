// Values inside an answer, and the confidence-marker underline that ties a value to the chart
// records stating it (hover or focus shows them; a click opens the record in the chart panel).
import type { ReactNode } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import { cap, fmtDate, unitText } from '../../app/dom.ts';
import { isRef, typeNoun } from '../../app/state.ts';
import type { AnswerPath } from '../../chart/trace.ts';
import { isDate, isObj, measurement, pathKey } from './answer.ts';
import type { Ctx } from './answer.ts';
import { openRecord } from './hooks.ts';

export const fmtValue = (n: unknown): string => String(n);
export const withUnit = (value: unknown, unit: string): string => {
  const u = unitText(unit);
  return u ? `${fmtValue(value)}${u === '%' ? ' %' : ' ' + u}` : fmtValue(value);
};

/** A record reference as its chart label, opening the record. */
export function RecordLink({ refKey, ctx, className }: { refKey: string; ctx: Ctx; className?: string }) {
  const row = ctx.sources.get(refKey);
  const label = row?.label || ctx.records.get(refKey)?.label || refKey;
  if (row && !row.exists) return <span className="font-mono text-muted-foreground text-xs" title="Not a record in this chart">{refKey}</span>;
  return (
    <button type="button" onClick={() => openRecord(refKey)} title={`Open ${refKey}`}
      className={cn('rounded-sm text-left underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50', className)}>
      {label}
    </button>
  );
}

/** One answer value as readable text. */
export function Value({ value, ctx }: { value: unknown; ctx: Ctx }): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">not recorded</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">none</span>;
    return value.map((v, i) => <span key={i}>{i ? ', ' : ''}<Value value={v} ctx={ctx} /></span>);
  }
  if (isObj(value)) {
    const m = measurement(value, ctx);
    if (m) return <>{m.name ? `${m.name} ` : ''}<span className="font-medium tabular-nums">{withUnit(m.value, m.unit)}</span>{m.date ? <span className="text-muted-foreground"> · {fmtDate(m.date)}</span> : null}</>;
    const entries = Object.entries(value);
    if (!entries.length) return <span className="text-muted-foreground">none</span>;
    return entries.map(([k, v], i) => <span key={k}>{i ? '; ' : ''}<span className="text-muted-foreground">{k.replace(/_/g, ' ')} </span><Value value={v} ctx={ctx} /></span>);
  }
  const text = String(value);
  if (isDate(text)) return fmtDate(text, { time: true });
  if (isRef(text)) return <RecordLink refKey={text} ctx={ctx} />;
  if (ctx.names[text]) return <span title={text}>{ctx.names[text]}</span>;
  if (/^[a-z]+(-[a-z]+)+$/.test(text)) return text.replace(/-/g, ' ');
  return text;
}

/**
 * The records behind the answer part at `path`, as an underline: solid when a cited record that
 * the run read states it, dotted (warning) when its record was cited but never retrieved, dotted
 * muted when it was only read, not cited. No sources: the children as they are.
 */
export function Cited({ path, ctx, children, className }: { path: AnswerPath; ctx: Ctx; children: ReactNode; className?: string }) {
  const claim = ctx.claims.get(pathKey(path));
  const refs = (claim?.sources ?? []).filter((r) => !r.startsWith('Patient/') || claim!.sources.length === 1);
  if (!claim || !refs.length) return <>{children}</>;
  const unread = refs.some((r) => !(ctx.sources.get(r)?.calls.length));
  const tone = unread ? 'unread' : claim.cited ? 'grounded' : 'read';
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          onClick={(e) => { e.stopPropagation(); openRecord(refs[0]!); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecord(refs[0]!); } }}
          className={cn(
            'cursor-pointer rounded-sm underline underline-offset-[5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
            tone === 'grounded' && 'decoration-foreground/25 decoration-1 hover:decoration-foreground/60',
            tone === 'read' && 'decoration-muted-foreground/50 decoration-dotted decoration-2',
            tone === 'unread' && 'decoration-warning decoration-dotted decoration-2',
            className,
          )}
        >
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-3">
        <p className="mb-2 text-muted-foreground text-xs">
          {tone === 'grounded' ? 'From the chart' : tone === 'unread' ? 'Cited, but the run never read this record' : 'Read while searching, not cited'}
        </p>
        <ul className="space-y-2">
          {refs.map((ref) => {
            const row = ctx.sources.get(ref);
            const view = ctx.records.get(ref);
            const type = row?.type ?? ref.split('/')[0];
            const date = row?.date ?? view?.date;
            return (
              <li key={ref}>
                <button type="button" onClick={() => openRecord(ref)} className="w-full rounded-md text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                  <span className="block font-medium text-sm">{row?.label || view?.label || ref}</span>
                  <span className="block text-muted-foreground text-xs">{[cap(typeNoun(type)), date ? fmtDate(date) : '', row?.status || view?.status].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">Click to open in the chart</p>
      </HoverCardContent>
    </HoverCard>
  );
}
