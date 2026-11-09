// The benchmark check of a benchmark run (what the ported scorer said; api.ts sets
// trace.benchmark), in the assistant-ui Score-breakdown look: a Pass/Fail verdict with "2 of 3
// checks", then one row each for Answer, Evidence and Chart changes, with a thin bar, a one-line
// note and the details behind a disclosure. Logic ported from round 1's thread-grade.ts.
import type { ReactNode } from 'react';
import { CheckIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { pyDumps } from '../../fhir/pyjson.ts';
import type { BenchmarkResult } from '../../chart/api.ts';
import { openRecord } from './hooks.ts';
import type { RunTrace } from './types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const pct = (x: unknown) => `${Math.round(100 * Number(x))}%`;
const yes = (x: unknown): boolean => x === true || Number(x) === 1;
const show = (v: unknown): string => (v === undefined ? '—' : pyDumps(v));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const WORDING: Record<string, string> = { keyed: 'Keyed', physician: 'Physician', nurse: 'Nurse', clerical: 'Front desk' };
function detailText(t: BenchmarkResult['task']): string {
  const premise = t.premise === null || t.premise === undefined ? '' : String(t.premise) === 'true' ? 'true premise' : 'false premise';
  return [WORDING[t.persona || 'keyed'] ?? t.persona, t.style, premise].filter(Boolean).join(' · ');
}

function Mark({ good }: { good: boolean }) {
  const Icon = good ? CheckIcon : XIcon;
  return <Icon className={cn('size-3.5 shrink-0', good ? 'text-success' : 'text-destructive')} aria-label={good ? 'right' : 'wrong'} />;
}

function RefItem({ refKey, trace, note }: { refKey: string; trace: RunTrace; note?: string }) {
  const row = (trace.sources ?? []).find((r) => r.ref === refKey);
  return (
    <li>
      <button type="button" onClick={() => openRecord(refKey)} className="rounded-sm text-left text-foreground underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50">
        {row?.label || refKey}
      </button>
      {note ? <span className="text-muted-foreground"> · {note}</span> : null}
    </li>
  );
}
function Sub({ title, children }: { title: string; children: ReactNode[] }) {
  if (!children.length) return null;
  return (
    <div>
      <p className="mb-1 text-muted-foreground text-xs">{title}</p>
      <ul className="space-y-1 text-sm">{children}</ul>
    </div>
  );
}

/** A brief description of a record the gold says to create. */
function brief(resource: Obj): string {
  const first = (v: unknown): string => (Array.isArray(v) ? first(v[0]) : isObj(v) ? first(v.contentString ?? v.text ?? v.display ?? v.code) : typeof v === 'string' ? v : '');
  const text = first(resource.description) || first(resource.payload) || first(resource.code) || first(resource.note) || first(resource.status);
  return `${String(resource.resourceType)}${text ? ': ' + text.slice(0, 80) : ''}`;
}
/** The empty search an absence rule asks for, in words: "Observation search for this patient with code 2160-0". */
function absenceSearch(scope: Obj): string {
  const type = String(scope.resourceType ?? 'record');
  if (scope.identifier !== undefined) return `${type} search for exactly identifier ${String(scope.identifier)}`;
  // v0.6: leaving the code or tag filter out only widens the search, so it counts too.
  const filter = scope.code !== undefined ? ` (code ${String(scope.code)} or no code filter)` : scope.tag !== undefined ? ` (tag ${String(scope.tag)} or no tag filter)` : '';
  return `${type} search for this patient${filter}`;
}

interface Need { text: string; done: boolean }
function requiredChanges(gold: Obj, audit: { method: string; ref: string }[]): Need[] {
  const needs: Need[] = [];
  for (const u of Array.isArray(gold.updates) ? gold.updates : []) {
    if (!isObj(u)) continue;
    needs.push({ text: `Update ${String(u.ref)}: ${String(u.field)} → ${show(u.value)}`, done: audit.some((a) => a.method === 'PUT' && a.ref === u.ref) });
  }
  const made = audit.filter((a) => a.method === 'POST').map((a) => a.ref.split('/')[0]);
  for (const c of Array.isArray(gold.creates) ? gold.creates : []) {
    if (!isObj(c)) continue;
    const at = made.indexOf(String(c.resourceType));
    if (at >= 0) made.splice(at, 1);
    needs.push({ text: `Create ${brief(c)}`, done: at >= 0 });
  }
  for (const d of strings(gold.deletes)) needs.push({ text: `Delete ${d}`, done: audit.some((a) => a.method === 'DELETE' && a.ref === d) });
  return needs;
}

function Criterion({ name, good, score, verdict, note, children }: { name: string; good: boolean; score: number | null; verdict: string; note: string; children?: ReactNode }) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex items-center gap-1.5 font-medium text-sm"><Mark good={good} />{name}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{verdict}</span>
      </div>
      {score !== null ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={cn('h-full rounded-full', good ? 'bg-success' : score > 0 ? 'bg-warning' : 'bg-destructive/60')} style={{ width: `${Math.max(score * 100, score > 0 ? 4 : 0)}%` }} />
        </div>
      ) : null}
    </>
  );
  if (!children) {
    return <li className="py-3">{body}<p className="mt-1.5 text-muted-foreground text-xs">{note}</p></li>;
  }
  return (
    <li className="py-3">
      <Collapsible>
        {body}
        <CollapsibleTrigger className="group mt-1.5 flex items-center gap-1 rounded-sm text-left text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
          {note}
          <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <div className="mt-3 space-y-3">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

export function GradeCard({ trace }: { trace: RunTrace }) {
  const b = trace.benchmark;
  if (!b) return null;
  const m = b.metrics;
  const header = (passed: boolean | null, checks: string | null) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {passed !== null ? (
        <span className={cn('rounded-full px-2.5 py-1 font-medium text-xs', passed ? 'bg-success/15 text-success' : 'bg-destructive/12 text-destructive')}>
          {passed ? 'Pass' : 'Fail'}
        </span>
      ) : null}
      {checks ? <span className="text-sm tabular-nums">{checks}</span> : null}
      <span className="min-w-0 text-muted-foreground text-sm">{b.label}{detailText(b.task) ? ` · ${detailText(b.task)}` : ''}</span>
    </div>
  );
  if (!m) {
    return (
      <section className="rounded-2xl border bg-card px-4 py-3" aria-label="Benchmark check">
        {header(null, 'Not graded')}
        <p className="mt-2 text-muted-foreground text-sm">This run could not be graded: {b.error ?? 'no result'}.</p>
      </section>
    );
  }

  const passed = yes(m.workflow_success);
  const goldAnswer = b.gold.answer;
  const parsed = trace.final && isObj(trace.final.parsed) ? trace.final.parsed : null;
  const got = parsed && 'answer' in parsed ? parsed.answer : undefined;
  const fields = isObj(goldAnswer) ? Object.keys(goldAnswer) : null;
  const gotObj = isObj(got) ? got : {};
  const accuracy = Number(m.answer_field_accuracy);
  const answerOk = yes(m.answer_success);
  const fieldCount = fields ? new Set([...fields, ...Object.keys(gotObj)]).size : 0;
  const extra = isObj(got) && fields ? Object.keys(gotObj).filter((k) => !fields.includes(k)) : [];
  const answerLines = fields
    ? fields.map((k) => ({ field: k, want: show((goldAnswer as Obj)[k]), have: show(gotObj[k]) }))
    : [{ field: 'answer', want: show(goldAnswer), have: show(got) }];

  // Evidence: keyed tasks need the records cited (and retrieved); natural-track tasks
  // (effect_graded) need them read, and each citation must be a retrieved record of this
  // patient. Records the run created itself are neutral either way.
  const cited = [...new Set(strings(trace.final?.evidence))];
  const retrieved = new Set((trace.sources ?? []).filter((r) => r.calls.length).map((r) => r.ref));
  const needed = strings(b.gold.evidence);
  const optional = strings(b.gold.optional_evidence);
  const created = new Set(b.audit.filter((a) => a.method === 'POST').map((a) => a.ref));
  const selfCited = cited.filter((r) => created.has(r));
  const counted = cited.filter((r) => !created.has(r) && !(optional.includes(r) && retrieved.has(r)));
  const optionalCited = cited.filter((r) => optional.includes(r) && !needed.includes(r) && retrieved.has(r));
  const byRetrieval = b.effect_graded;
  const relevant = needed.filter((r) => retrieved.has(r) && (byRetrieval || cited.includes(r)));
  const missed = needed.filter((r) => !relevant.includes(r));
  const stray = byRetrieval ? counted.filter((r) => !retrieved.has(r)) : counted.filter((r) => !needed.includes(r));
  const evidenceOk = Number(m.evidence_recall) === 1 && Number(m.evidence_precision) === 1;
  const fieldGap = !missed.length && Number(m.evidence_recall) < 1;
  const missedWhy = (r: string): string => (byRetrieval ? 'never read' : cited.includes(r) ? 'cited but never retrieved' : retrieved.has(r) ? 'read but not cited' : 'not cited');

  const needs = requiredChanges(b.gold, b.audit);
  const changes = trace.changes ?? [];
  const wrote = changes.length > 0 || b.audit.length > 0;
  const stateOk = yes(m.state_success);
  const harmful = yes(m.harmful_writes);
  const intact = yes(m.mutation_integrity);
  const changesOk = stateOk && !harmful && intact;
  const showChanges = needs.length > 0 || wrote;

  // Answers that something is not in the chart must be backed by an empty search over its scope.
  const absence = b.absence ?? null;
  const absenceOk = absence ? absence.checked : true;

  const checks = [answerOk, evidenceOk, ...(showChanges ? [changesOk] : []), ...(absence ? [absenceOk] : [])];
  const right = checks.filter(Boolean).length;
  // Every check shown passed, yet strict success says no: say so rather than look contradictory.
  const unexplained = !passed && right === checks.length;

  return (
    <section className="rounded-2xl border bg-card px-4 pt-3 pb-1" aria-label={`Benchmark check: ${passed ? 'pass' : 'fail'}`}>
      {header(passed, `${right} of ${checks.length} checks`)}
      {unexplained ? (
        <p className="mt-2 text-muted-foreground text-xs">Every check below passed, but the run failed another scoring rule (strict success is 0).</p>
      ) : null}
      <ul className="mt-1 divide-y">
        <Criterion name="Answer" good={answerOk} score={fields ? accuracy : answerOk ? 1 : 0}
          verdict={fields ? `${Math.round(accuracy * fieldCount)} of ${fieldCount} fields` : answerOk ? 'correct' : 'incorrect'}
          note={!parsed ? 'The reply is not a JSON object with answer and evidence.' : answerOk ? 'Matches the expected answer' : 'Expected and given values'}>
          {parsed && !answerOk ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-muted-foreground"><th className="w-5 py-1.5" /><th className="py-1.5 pr-3 text-left font-normal">Field</th><th className="py-1.5 pr-3 text-left font-normal">Expected</th><th className="py-1.5 text-left font-normal">Got</th></tr></thead>
                  <tbody className="divide-y">
                    {answerLines.map((l) => (
                      <tr key={l.field}>
                        <td className="py-1.5"><Mark good={l.want === l.have} /></td>
                        <th scope="row" className="py-1.5 pr-3 text-left font-medium">{l.field}</th>
                        <td className="break-all py-1.5 pr-3 font-mono">{l.want}</td>
                        <td className="break-all py-1.5 font-mono">{l.have}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {extra.length ? <p className="text-muted-foreground text-xs">Extra fields count as wrong: {extra.join(', ')}</p> : null}
            </>
          ) : undefined}
        </Criterion>

        <Criterion name="Evidence" good={evidenceOk} score={Number(m.evidence_recall)}
          verdict={`recall ${pct(m.evidence_recall)} · precision ${pct(m.evidence_precision)}`}
          note={byRetrieval
            ? `${relevant.length} of ${needed.length} needed records read${stray.length ? ` · ${stray.length} cited without being retrieved` : ''}`
            : `${relevant.length} of ${needed.length} needed records cited${stray.length ? ` · ${stray.length} not needed` : ''}`}>
          <Sub title={byRetrieval ? 'Needed, read' : 'Needed, cited'}>{relevant.map((r) => <RefItem key={r} refKey={r} trace={trace} />)}</Sub>
          <Sub title="Needed, missed">{missed.map((r) => <RefItem key={r} refKey={r} trace={trace} note={missedWhy(r)} />)}</Sub>
          <Sub title={byRetrieval ? 'Cited but not retrieved by the run' : 'Cited but not needed'}>{stray.map((r) => <RefItem key={r} refKey={r} trace={trace} />)}</Sub>
          <Sub title="Optional, cited (neither required nor penalized)">{optionalCited.map((r) => <RefItem key={r} refKey={r} trace={trace} />)}</Sub>
          <Sub title="Cited, created by this run (neither required nor penalized)">{selfCited.map((r) => <RefItem key={r} refKey={r} trace={trace} />)}</Sub>
          {byRetrieval ? <p className="text-muted-foreground text-xs">Natural-track rule: evidence is graded by what the run read, and each citation must be a record it retrieved.</p> : null}
          {fieldGap ? <p className="text-muted-foreground text-xs">Every needed record was reached, but a search never returned the fields that hold the evidence.</p> : null}
        </Criterion>

        {showChanges ? (
          <Criterion name="Chart changes" good={changesOk}
            score={needs.length ? needs.filter((n) => n.done).length / needs.length : changesOk ? 1 : 0}
            verdict={needs.length ? `${needs.filter((n) => n.done).length} of ${needs.length} required` : 'none required'}
            note={[harmful ? 'harmful or unrequested writes' : 'no harmful writes', intact ? 'other records untouched' : 'other records changed'].join(' · ')}>
            <Sub title="Required">{needs.map((n, i) => <li key={i} className="flex items-start gap-1.5"><span className="mt-1"><Mark good={n.done} /></span>{n.text}</li>)}</Sub>
            <Sub title="The run made">{changes.map((c, i) => <li key={i}>{c.verb} {c.noun} {c.label ? <span className="text-muted-foreground">“{c.label}” </span> : null}<span className="font-mono text-muted-foreground text-xs">{c.ref}</span></li>)}</Sub>
          </Criterion>
        ) : null}

        {absence ? (
          <Criterion name="Absence check" good={absenceOk} score={null}
            verdict={absenceOk ? 'proven' : 'not proven'}
            note={absenceOk
              ? `An empty ${absenceSearch(absence.scope)} proved it is not in the chart`
              : `Saying it is not in the chart needs an empty ${absenceSearch(absence.scope)}, with no other filters; none of the run's searches qualified`}
          />
        ) : null}
      </ul>
    </section>
  );
}
