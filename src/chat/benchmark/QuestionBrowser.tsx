// The question browser: search, This patient / All patients, compact filters, and a capped list
// (grouped by patient in All). Choosing a row sets the question, switching patient if needed.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { app } from '../../app/state.ts';
import { cap, fmtNum, plural } from '../../app/dom.ts';
import type { QuestionRow } from '../../chart/data.ts';
import {
  activeFilters, bench, byLabel, choose, familyLabel, loadIndex, loadPrompts, matches, NO_FILTERS, patientById,
  PREMISE, setFilters, setScope, STYLE, WORDING, wording,
} from './logic.ts';
import type { Filters } from './logic.ts';
import { useBench } from './useBench.ts';
import { cohortName } from '../shell/cohorts.ts';

const PAGE = 120;
const ANY = '__any';

export function QuestionBrowser({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(760px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl max-[640px]:h-dvh max-[640px]:max-w-full max-[640px]:rounded-none max-[640px]:border-0">
        {open && <BrowserBody close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function BrowserBody({ close }: { close: () => void }) {
  const b = useBench();
  const rows = b.index;
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [prompts, setPrompts] = useState<Map<string, Map<string, string>>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const pid = app.patient?.id ?? '';
  const scope = b.scope;

  useEffect(() => { void loadIndex().catch(() => {}); }, []);
  useEffect(() => { setLimit(PAGE); }, [search, scope, b.filters]);

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searchHit = (r: QuestionRow): boolean => {
    if (!words.length) return true;
    const text = [r.label, r.family, r.purpose, r.task_type, patientById(r.patient)?.name ?? '', prompts.get(r.patient)?.get(r.id) ?? ''].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  };

  const filtered = useMemo(() => (rows ?? []).filter((r) => matches(r) && searchHit(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, b.filters, search, prompts]);
  const mine = filtered.filter((r) => r.patient === pid);
  const totalMine = (rows ?? []).filter((r) => r.patient === pid).length;

  // Rows to show, grouped by patient in All scope (current patient first), capped at `limit`.
  const groups = useMemo(() => {
    const source = scope === 'patient' ? mine : filtered;
    const byPatient = new Map<string, QuestionRow[]>();
    for (const r of source) { let g = byPatient.get(r.patient); if (!g) byPatient.set(r.patient, (g = [])); g.push(r); }
    const order = [...byPatient.keys()].sort((a, b2) => (a === pid ? -1 : b2 === pid ? 1 : (patientById(a)?.name ?? a).localeCompare(patientById(b2)?.name ?? b2)));
    const out: { id: string; rows: QuestionRow[]; total: number }[] = [];
    let used = 0;
    for (const id of order) {
      if (used >= limit) break;
      const all = (byPatient.get(id) ?? []).sort(byLabel);
      const take = all.slice(0, limit - used);
      used += take.length;
      out.push({ id, rows: take, total: all.length });
    }
    return { out, used, total: source.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, scope, limit, pid]);

  // Load the prompts of the patients on screen (the previews; search then covers them too).
  const shownPatients = groups.out.map((g) => g.id).join();
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
    try { await choose(r); close(); }
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

  // Scroll the current question into view on open.
  useEffect(() => {
    if (!rows) return;
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!rows]);

  const countLine = scope === 'patient'
    ? `${plural(mine.length, 'question')} for ${app.patient?.name ?? 'this patient'}${mine.length !== totalMine ? ` · ${fmtNum(totalMine)} in all` : ''}`
    : `${plural(filtered.length, 'question')} across ${plural(new Set(filtered.map((r) => r.patient)).size, 'patient')}`;

  return (
    <>
      <div className="border-b px-5 pt-5 pb-4 max-[640px]:px-4">
        <DialogTitle className="text-base font-medium">Benchmark questions</DialogTitle>
        <DialogDescription className="mt-0.5 text-xs">
          {app.cohort ? `${cohortName(app.cohort)} · ${plural(rows?.length ?? app.cohort.tasks, 'question')}` : 'Choose a question to ask'}
        </DialogDescription>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-0 flex-1 basis-56 items-center gap-2 rounded-lg bg-muted px-3 text-sm">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus autoComplete="off"
              placeholder="Search questions or patients" aria-label="Search questions"
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); list.current?.querySelector<HTMLButtonElement>('[data-row]')?.focus(); } }}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
          <div role="group" aria-label="Which patients" className="inline-flex h-9 shrink-0 items-center rounded-lg bg-muted p-1 text-sm">
            {(['patient', 'all'] as const).map((s) => (
              <button
                key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
                className={cn('h-7 rounded-md px-3 text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  scope === s ? 'bg-background text-foreground shadow-xs dark:bg-accent' : 'hover:text-foreground')}
              >
                {s === 'patient' ? 'This patient' : 'All patients'}
              </button>
            ))}
          </div>
        </div>

        {rows && <FilterRow rows={rows} />}
      </div>

      <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-1 text-xs text-muted-foreground max-[640px]:px-4" aria-live="polite">
        <span>{error ?? countLine}</span>
      </div>

      <div ref={list} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 max-[640px]:px-2">
        {!rows && (b.indexError
          ? <p className="px-2 py-8 text-center text-sm text-destructive">{b.indexError}</p>
          : <p className="px-2 py-8 text-center text-sm text-muted-foreground">Loading the questions…</p>)}

        {rows && !groups.total && (
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-sm text-muted-foreground">
            <span>{search.trim() ? `No questions match “${search.trim()}”` : 'No questions match these filters'}</span>
            {activeFilters().length > 0 && <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => setFilters({ ...NO_FILTERS })}>Clear filters</Button>}
            {scope === 'patient' && filtered.length > 0 && (
              <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => setScope('all')}>
                See {plural(filtered.length, 'match', 'matches')} for all patients
              </Button>
            )}
          </div>
        )}

        {groups.out.map((g) => (
          <section key={g.id} aria-label={patientById(g.id)?.name ?? g.id} className="pt-1">
            {scope === 'all' && (
              <div className="sticky top-0 z-10 flex items-baseline gap-2 bg-background px-2 pt-3 pb-1.5 text-xs">
                <span className="font-medium text-foreground">{patientById(g.id)?.name ?? g.id}</span>
                {g.id === pid && <span className="text-muted-foreground">current patient</span>}
                <span className="ml-auto text-muted-foreground tabular-nums">{plural(g.total, 'question')}</span>
              </div>
            )}
            {g.rows.map((r) => (
              <QuestionRowButton
                key={r.id} r={r} prompt={prompts.get(r.patient)?.get(r.id)} current={r.id === app.question?.id}
                busy={choosing === r.id} onPick={() => void pick(r)}
              />
            ))}
          </section>
        ))}

        {groups.used < groups.total && (
          <div className="flex justify-center pt-3">
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setLimit((n) => n + PAGE)}>
              Show more · {fmtNum(groups.total - groups.used)} left
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

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

function QuestionRowButton({ r, prompt, current, busy, onPick }: { r: QuestionRow; prompt: string | undefined; current: boolean; busy: boolean; onPick: () => void }) {
  const natural = !!bench.index?.some((x) => x.persona);
  // A tagged release shows the purpose as a chip (QuestionTags).
  const meta = [tagged(r) ? null : cap(r.purpose), r.task_type, natural ? WORDING[wording(r)] ?? wording(r) : null].filter(Boolean).join(' · ');
  return (
    <button
      type="button" data-row aria-current={current ? 'true' : undefined} aria-busy={busy || undefined} onClick={onPick}
      className={cn('flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted',
        current && 'bg-muted/60', busy && 'opacity-60')}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{cap(r.label)}</span>
        <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          <span>{meta}</span>
          {r.style && r.style !== 'clean' && <span>· {(STYLE[r.style] ?? r.style).toLowerCase()}</span>}
          {String(r.premise) === 'false' && <span className="text-warning">· false premise</span>}
          {!r.read_only && <span className="text-warning">· writes</span>}
        </span>
        <QuestionTags r={r} className="mt-1" />
        {prompt
          ? <span className="mt-1 block truncate text-sm text-muted-foreground">{prompt}</span>
          : <span className="mt-1.5 block h-3.5 w-3/4 animate-pulse rounded bg-muted" aria-hidden="true" />}
      </span>
      {current && <Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-label="Current question" />}
    </button>
  );
}

// ---------- filters ----------

/** The values of a release tag (difficulty, specialty) in these rows; none where the release has none. */
function tagValues(rows: QuestionRow[], key: 'difficulty' | 'specialty'): [string, string][] {
  const found = [...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string' && v !== ''))];
  const order = ['easy', 'medium', 'hard', 'expert'];
  found.sort((a, b) => (key === 'difficulty' ? (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) : 0) || a.localeCompare(b));
  return found.map((v) => [v, cap(v)]);
}

/** Developer view: negatives by kind, the v0.2.3 kinds first. */
function negativeOptions(rows: QuestionRow[]): [string, string][] {
  const kinds = new Map<string, boolean>();
  for (const r of rows) if (r.negative && r.negative_kind) kinds.set(r.negative_kind, !!r.negative_new);
  if (!kinds.size) return [];
  const sorted = [...kinds].sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
  return [['any', 'Any negative'], ['new', 'New in v0.2.3'], ...sorted.map(([k, isNew]) => [k, `${cap(k)}${isNew ? ' (new)' : ''}`] as [string, string])];
}

function FilterRow({ rows }: { rows: QuestionRow[] }) {
  const f = bench.filters;
  const values = (key: 'family' | 'purpose' | 'task_type'): string[] => [...new Set(rows.map((r) => r[key]))];
  const natural = rows.some((r) => r.persona);
  const facets: { key: keyof Filters; label: string; options: [string, string][] }[] = [
    { key: 'family', label: 'Family', options: values('family').map((v) => [v, cap(familyLabel(v))] as [string, string]).sort((a, b) => a[1].localeCompare(b[1])) },
    { key: 'purpose', label: 'Purpose', options: values('purpose').sort().map((v) => [v, cap(v)]) },
    { key: 'task_type', label: 'Task type', options: values('task_type').sort().map((v) => [v, cap(v)]) },
    { key: 'wording', label: 'Wording', options: natural ? ['physician', 'nurse', 'clerical', 'keyed'].filter((w) => rows.some((r) => wording(r) === w)).map((w) => [w, WORDING[w] ?? w]) : [] },
    { key: 'style', label: 'Style', options: ['clean', 'typos', 'vague'].filter((s) => rows.some((r) => r.style === s)).map((s) => [s, STYLE[s] ?? s]) },
    { key: 'premise', label: 'Premise', options: ['true', 'false'].filter((p) => rows.some((r) => String(r.premise) === p)).map((p) => [p, PREMISE[p] ?? p]) },
    { key: 'difficulty', label: 'Difficulty', options: tagValues(rows, 'difficulty') },
    { key: 'specialty', label: 'Specialty', options: tagValues(rows, 'specialty') },
    { key: 'negative', label: 'Negatives', options: app.dev ? negativeOptions(rows) : [] },
    { key: 'effect', label: 'Writes', options: rows.some((r) => !r.read_only) && rows.some((r) => r.read_only) ? [['read', 'Read-only'], ['write', 'Writes to chart']] : [] },
  ];
  const shown = facets.filter((x) => x.options.length >= 2 || f[x.key]);
  const on = activeFilters().length;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 max-[640px]:-mx-4 max-[640px]:flex-nowrap max-[640px]:overflow-x-auto max-[640px]:px-4 max-[640px]:[scrollbar-width:none]">
      {shown.map(({ key, label, options }) => (
        <Select key={key} value={f[key] || ANY} onValueChange={(v) => setFilters({ ...f, [key]: v === ANY ? '' : v })}>
          <SelectTrigger
            size="sm" aria-label={label}
            className={cn('h-8 max-w-[13rem] shrink-0 gap-1.5 border-0 bg-transparent px-2.5 text-xs shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted',
              f[key] ? 'bg-muted font-medium text-foreground dark:bg-muted' : 'text-muted-foreground')}
          >
            {f[key] ? <SelectValue /> : <span>{label}</span>}
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="max-h-80">
            <SelectItem value={ANY} className="text-muted-foreground">Any {label.toLowerCase()}</SelectItem>
            {options.map(([v, t]) => <SelectItem key={v} value={v}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      ))}
      {on > 0 && (
        <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-muted-foreground" onClick={() => setFilters({ ...NO_FILTERS })}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
