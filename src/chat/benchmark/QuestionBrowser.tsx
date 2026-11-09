// The benchmark browser: a large dialog over the chat. Left, the facets as small distribution bars
// (counts update with the other filters; clicking a bar filters by it). Right, search, scope, sort
// and the matching questions. Choosing one switches to its patient and puts it in the composer
// (benchmark mode, not sent). On a phone the facets open as their own panel in place of the list.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowUpDown, Check, ChevronLeft, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { app, setMode } from '../../app/state.ts';
import { cap, fmtNum, plural } from '../../app/dom.ts';
import type { QuestionRow } from '../../chart/data.ts';
import {
  activeFilters, bench, choose, facetCounts, facetValue, familyLabel, loadAllPrompts, loadIndex, loadPrompts, matches, NO_FILTERS,
  patientById, premiseKind, PREMISE, setFilters, setScope, setSort, SORTS, sortRows, STYLE, WORDING, wording,
} from './logic.ts';
import type { Filters, Sort } from './logic.ts';
import { useBench } from './useBench.ts';
import { cohortName } from '../shell/cohorts.ts';

const PAGE = 100;

export function QuestionBrowser({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(820px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl max-[640px]:h-dvh max-[640px]:max-w-full max-[640px]:rounded-none max-[640px]:border-0"
      >
        {open && <BrowserBody close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

// ---------- facets ----------

interface Facet {
  key: keyof Filters;
  label: string;
  /** Display name of a value. */
  name: (v: string) => string;
  /** Fixed value order (else by count). */
  order?: string[];
  /** Values shown before "Show all". */
  top?: number;
  /** Long facets drop values the other filters leave at zero (short ones keep them, dimmed). */
  hideZero?: boolean;
}

const DIFFICULTY = ['easy', 'medium', 'hard', 'expert'];
function facetsFor(rows: QuestionRow[]): Facet[] {
  const has = (key: keyof QuestionRow) => rows.some((r) => r[key] !== null && r[key] !== undefined && r[key] !== '');
  const natural = rows.some((r) => r.persona);
  const list: (Facet | false)[] = [
    has('specialty') && { key: 'specialty', label: 'Specialty', name: (v) => v, top: 8 },
    has('subspecialty') && { key: 'subspecialty', label: 'Subspecialty', name: cap, top: 6, hideZero: true },
    has('difficulty') && { key: 'difficulty', label: 'Difficulty', name: cap, order: DIFFICULTY },
    natural && { key: 'wording', label: 'Who is asking', name: (v) => WORDING[v] ?? cap(v), order: ['physician', 'nurse', 'clerical', 'keyed'] },
    { key: 'premise', label: 'Premise', name: (v) => PREMISE[v] ?? cap(v), order: ['true', 'negative', 'false'] },
    has('style') && { key: 'style', label: 'Wording', name: (v) => STYLE[v] ?? cap(v), order: ['clean', 'typos', 'vague'] },
    { key: 'effect', label: 'Reads or writes', name: (v) => (v === 'read' ? 'Read-only' : 'Writes to the chart'), order: ['read', 'write'] },
    { key: 'purpose', label: 'Purpose', name: cap },
    { key: 'task_type', label: 'Task type', name: cap },
    { key: 'family', label: 'Family', name: (v) => cap(familyLabel(v)), top: 8, hideZero: true },
    app.dev && rows.some((r) => r.negative_kind) && { key: 'negative', label: 'Negative kind', name: cap, top: 8, hideZero: true },
  ];
  return list.filter((f): f is Facet => !!f);
}

function FacetBars({ facet, rows }: { facet: Facet; rows: QuestionRow[] }) {
  const f = bench.filters;
  const active = f[facet.key];
  const [all, setAll] = useState(false);
  const counts = facetCounts(rows, facet.key);
  // Every value the facet has (zero counts stay, dimmed, so the distribution doesn't hide them).
  let values = [...new Set(rows.map((r) => facetValue(r, facet.key)).filter(Boolean))];
  if (facet.hideZero) values = values.filter((v) => counts.has(v));
  if (active && !values.includes(active)) values.push(active);
  values.sort(facet.order
    ? (a, b) => (facet.order!.indexOf(a) + 1 || 99) - (facet.order!.indexOf(b) + 1 || 99) || a.localeCompare(b)
    : (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || facet.name(a).localeCompare(facet.name(b)));
  // A facet with one value only says nothing (unless it is the active filter).
  if (values.length < 2 && !active) return null;
  const max = Math.max(1, ...counts.values());
  const top = facet.top ?? values.length;
  const total = values.length;
  const hidden = total - top;
  if (!all && hidden > 1) {
    const shown = values.slice(0, top);
    if (active && !shown.includes(active)) shown.push(active);
    values = shown;
  }
  const toggle = (v: string) => {
    const next = { ...f, [facet.key]: active === v ? '' : v };
    // A subspecialty belongs to one specialty: drop it when the specialty changes.
    if (facet.key === 'specialty' && next.subspecialty && !(bench.index ?? []).some((r) => r.specialty === next.specialty && r.subspecialty === next.subspecialty)) next.subspecialty = '';
    setFilters(next);
  };
  const id = `facet-${facet.key}`;
  return (
    <section aria-labelledby={id} className="pb-4">
      <div className="flex items-baseline justify-between px-2 pb-1">
        <h3 id={id} className="text-xs font-medium text-muted-foreground">{facet.label}</h3>
        {active && (
          <button type="button" onClick={() => setFilters({ ...f, [facet.key]: '' })}
            className="rounded text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline">
            Clear
          </button>
        )}
      </div>
      <ul className="space-y-px">
        {values.map((v) => {
          const n = counts.get(v) ?? 0;
          const on = active === v;
          return (
            <li key={v}>
              <button
                type="button" aria-pressed={on} onClick={() => toggle(v)}
                aria-label={`${facet.name(v)}: ${plural(n, 'question')}`}
                className={cn('relative flex h-7 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
                  on ? 'font-medium text-foreground' : n ? 'text-foreground/85' : 'text-muted-foreground')}
              >
                <span aria-hidden="true"
                  className={cn('absolute inset-y-1 left-0 rounded-r-sm transition-[width] duration-200', on ? 'bg-brand/25' : 'bg-foreground/[0.07]')}
                  style={{ width: `${(100 * n) / max}%` }} />
                <span className="relative min-w-0 flex-1 truncate">{facet.name(v)}</span>
                <span className="relative shrink-0 text-xs text-muted-foreground tabular-nums">{fmtNum(n)}</span>
                {on && <Check className="relative size-3.5 shrink-0" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 1 && (
        <button type="button" onClick={() => setAll(!all)} aria-expanded={all}
          className="mt-0.5 ml-2 rounded text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline">
          {all ? 'Show fewer' : `Show all ${fmtNum(total)}`}
        </button>
      )}
    </section>
  );
}

// ---------- the dialog body ----------

function BrowserBody({ close }: { close: () => void }) {
  const b = useBench();
  const rows = b.index;
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [prompts, setPrompts] = useState<Map<string, Map<string, string>>>(new Map());
  const [allPrompts, setAllPrompts] = useState<'no' | 'loading' | 'yes'>('no');
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [facetsOpen, setFacetsOpen] = useState(false);  // phone: the facets panel in place of the list
  const list = useRef<HTMLDivElement>(null);
  const pid = app.patient?.id ?? '';
  const scope = b.scope;

  useEffect(() => { void loadIndex().catch(() => {}); }, []);
  useEffect(() => { setLimit(PAGE); list.current?.scrollTo({ top: 0 }); }, [search, scope, b.filters, b.sort]);

  // The question text is searched too: every patient's prompts load on the first search.
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  useEffect(() => {
    if (!words.length || allPrompts !== 'no' || !rows) return;
    setAllPrompts('loading');
    const got = new Map<string, Map<string, string>>();
    let live = true;
    void loadAllPrompts((id, m) => { got.set(id, m); }).then(() => {
      if (!live) return;
      setPrompts((prev) => { const out = new Map(prev); for (const [id, m] of got) out.set(id, m); return out; });
      setAllPrompts('yes');
    });
    return () => { live = false; setAllPrompts((s) => (s === 'loading' ? 'no' : s)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words.length > 0, rows]);

  const searchHit = (r: QuestionRow): boolean => {
    if (!words.length) return true;
    const text = [r.label, r.family, r.purpose, r.task_type, r.specialty ?? '', r.subspecialty ?? '', patientById(r.patient)?.name ?? '', prompts.get(r.patient)?.get(r.id) ?? '']
      .join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  };

  // The rows the facets count over (scope and search), then the filtered and sorted list.
  const pool = useMemo(() => (rows ?? []).filter((r) => (scope === 'all' || r.patient === pid) && searchHit(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, scope, pid, search, prompts]);
  const filtered = useMemo(() => sortRows(pool.filter((r) => matches(r)), b.sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, b.filters, b.sort, b.index]);
  const facets = useMemo(() => facetsFor(rows ?? []), [rows, app.dev]);  // eslint-disable-line react-hooks/exhaustive-deps
  const shown = filtered.slice(0, limit);
  const on = activeFilters().length;

  // Load the prompts of the rows on screen (the previews).
  const shownPatients = [...new Set(shown.map((r) => r.patient))].join();
  useEffect(() => {
    let live = true;
    for (const id of shownPatients.split(',').filter(Boolean)) {
      if (prompts.has(id)) continue;
      void loadPrompts(id).then((m) => { if (live) setPrompts((prev) => (prev.has(id) ? prev : new Map(prev).set(id, m))); }).catch(() => {});
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownPatients]);

  async function pick(r: QuestionRow): Promise<void> {
    setChoosing(r.id);
    setError(null);
    try { setMode('benchmark'); await choose(r); close(); }
    catch (e) { setError('Could not load this question: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setChoosing(null); }
  }

  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const patients = new Set(filtered.map((r) => r.patient)).size;
  const countLine = scope === 'patient'
    ? `${plural(filtered.length, 'question')} for ${app.patient?.name ?? 'this patient'}`
    : `${plural(filtered.length, 'question')} across ${plural(patients, 'patient')}`;
  const searching = words.length > 0 && allPrompts === 'loading';

  const facetPanel = rows && (
    <div className="px-2 pt-3">
      <p className="px-2 pb-3 text-xs text-muted-foreground" aria-live="polite">
        {on ? plural(on, 'filter selected', 'filters selected') : 'No filters selected'}
      </p>
      {facets.map((facet) => <FacetBars key={facet.key} facet={facet} rows={pool} />)}
    </div>
  );

  return (
    <>
      <div className="border-b px-5 pt-5 pb-3 max-[640px]:px-4 max-[640px]:pt-4">
        <DialogTitle className="pr-8 text-base font-medium">Benchmark questions</DialogTitle>
        <DialogDescription className="mt-0.5 text-xs">
          {app.cohort ? `${cohortName(app.cohort)} · ${plural(rows?.length ?? app.cohort.tasks, 'question')}. Choose one to put it in the composer; its patient opens with it.` : 'Choose a question to ask'}
        </DialogDescription>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-0 flex-1 basis-60 items-center gap-2 rounded-lg bg-muted px-3 text-sm">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus autoComplete="off"
              placeholder="Search question text, specialty or patient" aria-label="Search questions"
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); list.current?.querySelector<HTMLButtonElement>('[data-row]')?.focus(); } }}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
          <div role="group" aria-label="Which patients" className="inline-flex h-9 shrink-0 items-center rounded-lg bg-muted p-1 text-sm max-[640px]:mr-auto">
            {(['all', 'patient'] as const).map((s) => (
              <button
                key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
                className={cn('h-7 rounded-md px-3 text-muted-foreground max-[640px]:px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  scope === s ? 'bg-background text-foreground shadow-xs dark:bg-accent' : 'hover:text-foreground')}
              >
                {s === 'patient' ? 'This patient' : 'All patients'}
              </button>
            ))}
          </div>
          <Select value={b.sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger size="sm" aria-label={`Sort: ${SORTS.find(([s]) => s === b.sort)?.[1] ?? ''}`}
              className="h-9 shrink-0 gap-1.5 border-0 bg-muted px-3 text-sm shadow-none dark:bg-muted max-[640px]:px-2.5 max-[640px]:[&>svg:last-child]:hidden">
              <ArrowUpDown className="size-4 text-muted-foreground min-[641px]:hidden" aria-hidden="true" />
              <span className="text-muted-foreground max-[640px]:hidden">Sort:</span>
              <span className="max-[640px]:hidden"><SelectValue /></span>
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {SORTS.filter(([s]) => s !== 'patient' || scope === 'all').map(([s, t]) => <SelectItem key={s} value={s}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            type="button" variant="secondary" aria-expanded={facetsOpen} onClick={() => setFacetsOpen(!facetsOpen)}
            className="h-9 shrink-0 gap-1.5 bg-muted px-3 text-sm font-normal min-[641px]:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filters{on ? ` · ${on}` : ''}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside aria-label="Filters" className="w-72 shrink-0 overflow-y-auto overscroll-contain border-r max-[640px]:hidden">
          {facetPanel}
        </aside>

        {facetsOpen && (
          <div className="flex min-h-0 flex-1 flex-col min-[641px]:hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Filters" role="region">{facetPanel}</div>
            <div className="flex gap-2 border-t p-3">
              {on > 0 && <Button variant="ghost" onClick={() => setFilters({ ...NO_FILTERS })}>Clear filters</Button>}
              <Button className="flex-1" onClick={() => setFacetsOpen(false)}>
                <ChevronLeft className="size-4" aria-hidden="true" /> Show {plural(filtered.length, 'question')}
              </Button>
            </div>
          </div>
        )}

        <div className={cn('flex min-w-0 flex-1 flex-col', facetsOpen && 'max-[640px]:hidden')}>
          <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-3 pb-1 text-xs text-muted-foreground max-[640px]:px-4" aria-live="polite">
            <span className={cn(error && 'text-destructive')}>{error ?? countLine}</span>
            {searching && <span>· searching the question text…</span>}
            {on > 0 && <ActiveFilters />}
          </div>

          <div ref={list} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 max-[640px]:px-2">
            {!rows && (b.indexError
              ? <p className="px-2 py-8 text-center text-sm text-destructive">{b.indexError}</p>
              : <p className="px-2 py-8 text-center text-sm text-muted-foreground">Loading the questions…</p>)}

            {rows && !filtered.length && (
              <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-sm text-muted-foreground">
                <span>{search.trim() ? `No questions match “${search.trim()}”` : 'No questions match these filters'}</span>
                {on > 0 && <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => setFilters({ ...NO_FILTERS })}>Clear filters</Button>}
                {scope === 'patient' && <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => setScope('all')}>Search all patients</Button>}
              </div>
            )}

            <ul aria-label="Questions">
              {shown.map((r) => (
                <li key={r.id}>
                  <QuestionRowButton
                    r={r} prompt={prompts.get(r.patient)?.get(r.id)} current={r.id === app.question?.id}
                    showPatient={scope === 'all'} here={r.patient === pid} busy={choosing === r.id} onPick={() => void pick(r)}
                  />
                </li>
              ))}
            </ul>

            {shown.length < filtered.length && (
              <div className="flex justify-center pt-3">
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setLimit((n) => n + PAGE)}>
                  Show more · {fmtNum(filtered.length - shown.length)} left
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** The active filters as removable chips over the list. */
function ActiveFilters() {
  const f = bench.filters;
  const facets = facetsFor(bench.index ?? []);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {activeFilters().map((key) => {
        const facet = facets.find((x) => x.key === key);
        const text = facet ? facet.name(f[key]) : cap(f[key]);
        return (
          <button key={key} type="button" onClick={() => setFilters({ ...f, [key]: '' })} aria-label={`Remove filter ${text}`}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-brand-soft px-2 text-xs text-foreground outline-none hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-ring/50">
            {text}<span aria-hidden="true" className="text-muted-foreground">×</span>
          </button>
        );
      })}
      <button type="button" onClick={() => setFilters({ ...NO_FILTERS })}
        className="rounded px-1 text-xs underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline">
        Clear all
      </button>
    </span>
  );
}

// ---------- rows and tags ----------

const CHIP = 'rounded-md bg-muted px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground';
/** Whether this release tags its questions (natural v0.2.3 on). */
const tagged = (r: QuestionRow): boolean => typeof r.difficulty === 'string' && r.difficulty !== '';

/**
 * The release's tags as small chips: structural difficulty, specialty and purpose; in the
 * developer view also the negative kind (new v0.2.3 kinds marked), stretch, one-search lookups and
 * the teachers' difficulty bin. Nothing for releases without tags.
 */
export function QuestionTags({ r, className }: { r: QuestionRow; className?: string }) {
  if (!tagged(r)) return null;
  const tags = [r.difficulty && `${cap(r.difficulty)}`, r.specialty, r.purpose].filter((v): v is string => typeof v === 'string' && v !== '');
  const dev: { text: string; title: string; strong?: boolean }[] = [];
  if (app.dev) {
    if (r.negative) {
      dev.push({
        text: `Negative: ${r.negative_kind ?? 'unspecified'}${r.negative_new ? ' (new)' : ''}`,
        title: r.negative_new ? 'A negative kind new in v0.2.3, with a matched true twin' : 'A negative: the right answer is that the chart does not show it',
        strong: !!r.negative_new,
      });
    }
    if (r.stretch) dev.push({ text: 'Stretch', title: 'Unsolved by every teacher' });
    if (r.single_hop) dev.push({ text: 'Single hop', title: 'One-search lookup (the easy slice)' });
    if (r.difficulty_empirical) dev.push({ text: `Teachers: ${r.difficulty_empirical}`, title: 'Empirical difficulty bin (measured on dev, estimated for held-out)' });
  }
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {tags.map((t) => <span key={t} className={CHIP}>{cap(t)}</span>)}
      {dev.map((t) => (
        <span key={t.text} title={t.title} data-dev-tag className={cn(CHIP, 'border border-dashed border-foreground/15', t.strong && 'text-warning')}>{t.text}</span>
      ))}
    </span>
  );
}

const DOT: Record<string, string> = { easy: 'bg-emerald-500', medium: 'bg-amber-500', hard: 'bg-rose-500' };

function QuestionRowButton({ r, prompt, current, showPatient, here, busy, onPick }: {
  r: QuestionRow; prompt: string | undefined; current: boolean; showPatient: boolean; here: boolean; busy: boolean; onPick: () => void;
}) {
  const natural = !!r.persona;
  const meta = [
    r.specialty ? (r.subspecialty ? `${r.specialty} · ${r.subspecialty}` : r.specialty) : cap(r.purpose),
    natural ? WORDING[wording(r)] ?? wording(r) : r.task_type,
  ].filter(Boolean).join(' · ');
  const kind = premiseKind(r);
  return (
    <button
      type="button" data-row aria-current={current ? 'true' : undefined} aria-busy={busy || undefined} onClick={onPick}
      className={cn('flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
        current && 'bg-muted/60', busy && 'opacity-60')}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          {r.difficulty && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title={`Difficulty: ${r.difficulty}`}>
              <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT[r.difficulty] ?? 'bg-muted-foreground')} />
              <span className="w-12">{cap(r.difficulty)}</span>
            </span>
          )}
          <span className="min-w-0 truncate text-sm font-medium">{cap(r.label)}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          <span>{meta}</span>
          {r.style && r.style !== 'clean' && <span>· {(STYLE[r.style] ?? r.style).toLowerCase()}</span>}
          {kind === 'false' && <span className="text-warning">· false premise</span>}
          {kind === 'negative' && <span>· answer is no</span>}
          {!r.read_only && <span className="text-warning">· writes</span>}
          {showPatient && <span>· {patientById(r.patient)?.name ?? r.patient}{here ? ' (open)' : ''}</span>}
        </span>
        {prompt
          ? <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{prompt}</span>
          : <span className="mt-1.5 block h-3.5 w-3/4 animate-pulse rounded bg-muted" aria-hidden="true" />}
      </span>
      {current && <Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-label="Current question" />}
    </button>
  );
}
