// Benchmark question picking, without any DOM: the React views (BenchmarkQuestion, QuestionBrowser)
// read `bench` and call the actions below; they re-render on `onBench`.
//
// Rules (unchanged from round 1): a question is always showing in benchmark mode unless the user
// clears it. The default is balanced: the best-worded question of the families (natural and clean
// first, true premise first). Shuffle picks from the whole dataset (switching patient). When the
// user switches patient, a replacement question for that patient follows: one matching the
// filters, or the best other one with a short note saying the filters were relaxed.
import { app, api, on, setQuestion } from '../../app/state.ts';
import type { ChosenQuestion } from '../../app/state.ts';
import { fetchData } from '../../chart/data.ts';
import type { QuestionRow } from '../../chart/data.ts';
import type { ChartPatient } from '../../types.ts';
import { cap, storage } from '../../app/dom.ts';

// ---------- facets and filters ----------

export interface Filters {
  family: string;
  purpose: string;
  task_type: string;
  wording: string;   // physician | nurse | clerical | keyed
  style: string;     // clean | typos | vague
  premise: string;   // true | false
  effect: string;    // read | write
  difficulty: string; // release tags (natural v0.2.3 on); empty where a release has none
  specialty: string;
  subspecialty: string;
  negative: string;   // developer view: a negative kind, or "new" / "any"
}
export const NO_FILTERS: Filters = { family: '', purpose: '', task_type: '', wording: '', style: '', premise: '', effect: '', difficulty: '', specialty: '', subspecialty: '', negative: '' };

export const WORDING: Record<string, string> = { physician: 'Physician', nurse: 'Nurse', clerical: 'Front desk', keyed: 'Keyed' };
export const STYLE: Record<string, string> = { clean: 'Clean', typos: 'Typos', vague: 'Vague' };
export const PREMISE: Record<string, string> = { true: 'True premise', false: 'False premise', negative: 'True premise, answer is no' };

export const wording = (r: QuestionRow): string => r.persona || 'keyed';
export const premiseOf = (r: QuestionRow): string => (r.premise === null || r.premise === undefined ? '' : String(r.premise));

/**
 * The premise as the browser groups it: a false premise, a true premise whose right answer is
 * "no" / "not in the chart" (a negative), or a plain true premise. Empty where the release has none.
 */
export function premiseKind(r: QuestionRow): string {
  const p = premiseOf(r);
  if (p === 'false') return 'false';
  if (p === 'true') return r.negative ? 'negative' : 'true';
  return p;
}

/** A row's value for one facet ('' where it has none). */
export function facetValue(r: QuestionRow, key: keyof Filters): string {
  switch (key) {
    case 'wording': return wording(r);
    case 'premise': return premiseKind(r);
    case 'effect': return r.read_only ? 'read' : 'write';
    case 'negative': return r.negative ? r.negative_kind ?? '' : '';
    default: return r[key] ?? '';
  }
}

const FILTER_KEYS = Object.keys(NO_FILTERS) as (keyof Filters)[];

export function matches(r: QuestionRow, f: Filters = bench.filters): boolean {
  for (const key of FILTER_KEYS) {
    const want = f[key];
    if (!want || key === 'negative') continue;
    if (facetValue(r, key) !== want) return false;
  }
  // The negatives filter is a developer-view one: off while that view is.
  const neg = app.dev ? f.negative : '';
  if (neg === 'any' && !r.negative) return false;
  if (neg === 'new' && !r.negative_new) return false;
  if (neg && neg !== 'any' && neg !== 'new' && r.negative_kind !== neg) return false;
  return true;
}

/**
 * Per-facet counts for the browser's distribution bars: for each value, how many rows match every
 * other active filter (so the bars show what choosing that value would leave).
 */
export function facetCounts(rows: QuestionRow[], key: keyof Filters, f: Filters = bench.filters): Map<string, number> {
  const others = { ...f, [key]: '' };
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!matches(r, others)) continue;
    const v = facetValue(r, key);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

export type Sort = 'name' | 'easiest' | 'hardest' | 'specialty' | 'patient';
export const SORTS: [Sort, string][] = [['name', 'Name'], ['easiest', 'Easiest first'], ['hardest', 'Hardest first'], ['specialty', 'Specialty'], ['patient', 'Patient']];
const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'expert'];
const rank = (r: QuestionRow): number => { const i = DIFFICULTY_ORDER.indexOf(r.difficulty ?? ''); return i < 0 ? 99 : i; };

/** The browser's sort orders; ties fall back to name order. */
export function sortRows(rows: QuestionRow[], sort: Sort, patientName: (id: string) => string = (id) => patientById(id)?.name ?? id): QuestionRow[] {
  const out = [...rows];
  const cmp: Record<Sort, (a: QuestionRow, b: QuestionRow) => number> = {
    name: () => 0,
    easiest: (a, b) => rank(a) - rank(b),
    hardest: (a, b) => (rank(b) === 99 ? -1 : rank(b)) - (rank(a) === 99 ? -1 : rank(a)),
    specialty: (a, b) => (a.specialty ?? '\uffff').localeCompare(b.specialty ?? '\uffff') || (a.subspecialty ?? '').localeCompare(b.subspecialty ?? ''),
    patient: (a, b) => patientName(a.patient).localeCompare(patientName(b.patient)),
  };
  return out.sort((a, b) => cmp[sort](a, b) || byLabel(a, b));
}

/** Difficulties a random pick prefers when no difficulty filter is set. */
export const DEFAULT_DIFFICULTY = new Set(['medium', 'hard']);
/**
 * Random and default picks lean to medium and hard questions: with no difficulty filter on, the
 * pool is cut to them when it has any (releases without tags, and pools with none, are unchanged).
 */
export function harder(rows: QuestionRow[], f: Filters = bench.filters): QuestionRow[] {
  if (f.difficulty) return rows;
  const cut = rows.filter((r) => DEFAULT_DIFFICULTY.has(r.difficulty ?? ''));
  return cut.length ? cut : rows;
}
export const activeFilters = (): (keyof Filters)[] =>
  (Object.keys(bench.filters) as (keyof Filters)[]).filter((k) => bench.filters[k] && (k !== 'negative' || app.dev));

/** The active filters in words: "physician, false-premise". */
function filterSummary(): string {
  const f = bench.filters;
  const words: string[] = [];
  if (f.family) words.push(familyLabel(f.family));
  if (f.purpose) words.push(f.purpose);
  if (f.task_type) words.push(f.task_type);
  if (f.wording) words.push((WORDING[f.wording] ?? f.wording).toLowerCase());
  if (f.style) words.push(f.style);
  if (f.premise) words.push(f.premise === 'negative' ? 'answer-is-no' : `${f.premise}-premise`);
  if (f.effect) words.push(f.effect === 'read' ? 'read-only' : 'chart-change');
  if (f.difficulty) words.push(f.difficulty);
  if (f.specialty) words.push(f.specialty);
  if (f.subspecialty) words.push(f.subspecialty);
  if (f.negative && app.dev) words.push(f.negative === 'any' ? 'negative' : f.negative === 'new' ? 'new-negative' : f.negative);
  return words.join(', ');
}

const PERSONAS = ['physician', 'nurse', 'clerical'];
/** Which wording to prefer: natural and clean first, then any natural, then keyed; true premise first. */
function preference(r: QuestionRow): [number, number, number] {
  const natural = !!r.persona;
  return [natural ? (r.style === 'clean' || !r.style ? 0 : 1) : 2, premiseOf(r) === 'false' ? 1 : 0, Math.max(PERSONAS.indexOf(r.persona ?? ''), 0)];
}
function compare(a: QuestionRow, b: QuestionRow): number {
  const x = preference(a), y = preference(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/** One question per family (the preferred wording). */
function balanced(rows: QuestionRow[]): QuestionRow[] {
  const best = new Map<string, QuestionRow>();
  for (const r of rows) {
    const current = best.get(r.family);
    if (!current || compare(r, current) < 0) best.set(r.family, r);
  }
  return [...best.values()];
}
/** The balanced default: the best-worded question of the families, families in name order. */
function bestOf(rows: QuestionRow[]): QuestionRow | undefined {
  const [first] = balanced(rows).sort((a, b) => {
    const x = preference(a), y = preference(b);
    return x[0] - y[0] || x[1] - y[1] || a.label.localeCompare(b.label) || compare(a, b);
  });
  return first;
}
export const byLabel = (a: QuestionRow, b: QuestionRow): number => a.label.localeCompare(b.label) || compare(a, b);

// ---------- state ----------

export type Scope = 'patient' | 'all';

export const bench = {
  /** The cohort's questions.json, once loaded. */
  index: null as QuestionRow[] | null,
  indexError: null as string | null,
  filters: { ...NO_FILTERS, ...storage.get<Partial<Filters>>('bench-filters', {}) } as Filters,
  /** The question browser's scope (remembered). */
  scope: (storage.get<Scope>('bench-scope', 'all') === 'patient' ? 'patient' : 'all') as Scope,
  /** The browser's sort order (remembered). */
  sort: (SORTS.some(([s]) => s === storage.get<string>('bench-sort', 'name')) ? storage.get<Sort>('bench-sort', 'name') : 'name') as Sort,
  /** A short note under the question (filters relaxed, nothing else to pick, …). */
  note: null as string | null,
  /** Choosing a question (loading its prompt). */
  picking: false,
  pickError: null as string | null,
  /** The user cleared the question: stay empty until they pick. */
  cleared: false,
};

const listeners = new Set<() => void>();
/** Re-render hook for the views: called after any change to `bench` (or the question). */
export function onBench(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
function changed(): void { for (const fn of listeners) { try { fn(); } catch (error) { console.error('[bench]', error); } } }

let pendingNote: string | null = null;  // becomes `note` with the next question event
let seq = 0;

// ---------- data ----------

let indexLoad: Promise<QuestionRow[]> | null = null;
export function loadIndex(): Promise<QuestionRow[]> {
  if (!app.cohort) return Promise.reject(new Error('The dataset is not loaded yet'));
  if (!indexLoad) {
    bench.indexError = null;
    indexLoad = fetchData<QuestionRow[]>(`${app.cohort.id}/questions.json`).then((rows) => { bench.index = rows; changed(); return rows; });
    indexLoad.catch((error: unknown) => { indexLoad = null; bench.indexError = error instanceof Error ? error.message : String(error); changed(); });
  }
  return indexLoad;
}

/** Questions per patient in the active cohort (the patient switcher shows them). */
let counts: Map<string, number> | null = null;
export function questionCounts(): Map<string, number> | null {
  if (!counts && bench.index) {
    counts = new Map();
    for (const row of bench.index) counts.set(row.patient, (counts.get(row.patient) ?? 0) + 1);
  }
  return counts;
}

const familyLabels = new Map<string, string>();
export const familyLabel = (family: string): string => {
  if (!familyLabels.size && bench.index) for (const r of bench.index) familyLabels.set(r.family, r.label);
  return familyLabels.get(family) ?? family.replace(/_/g, ' ');
};

const promptCache = new Map<string, Promise<Map<string, string>>>();
/** The exact prompts of one patient's questions (id -> prompt). */
export function loadPrompts(patientId: string): Promise<Map<string, string>> {
  let entry = promptCache.get(patientId);
  if (!entry) {
    entry = api<{ tasks: { id: string | null; prompt?: string }[] }>('/api/benchmark', { patient: patientId })
      .then(({ tasks }) => new Map(tasks.filter((t) => t.id && typeof t.prompt === 'string').map((t) => [t.id as string, t.prompt as string])));
    entry.catch(() => promptCache.delete(patientId));
    promptCache.set(patientId, entry);
  }
  return entry;
}
/** Every patient's prompts, for searching the question text (loaded on the first search). */
export async function loadAllPrompts(onEach: (patient: string, prompts: Map<string, string>) => void): Promise<void> {
  const ids = [...new Set((await loadIndex()).map((r) => r.patient))];
  await Promise.all(ids.map((id) => loadPrompts(id).then((m) => onEach(id, m)).catch(() => {})));
}
async function chosen(row: QuestionRow): Promise<ChosenQuestion> {
  const prompt = (await loadPrompts(row.patient)).get(row.id);
  if (prompt === undefined) throw new Error('This question’s prompt is missing from the export');
  return { ...row, prompt };
}

export const patientById = (id: string): ChartPatient | undefined => app.patients.find((p) => p.id === id);
const firstName = (p: ChartPatient | undefined): string => p?.name.split(/\s+/)[0] ?? 'this patient';

// ---------- picking ----------

async function apply(row: QuestionRow, token: number, text: string | null): Promise<void> {
  const q = await chosen(row);
  if (token !== seq) return;
  bench.picking = false;
  pendingNote = text;
  bench.cleared = false;
  setQuestion(q);
}

/** A question for this patient: matching the filters if any do, else the best other one (with a note). */
async function pickFor(patient: ChartPatient, { allowSwitch }: { allowSwitch: boolean }): Promise<void> {
  const token = ++seq;
  bench.picking = true;
  bench.pickError = null;
  changed();
  try {
    const rows = (await loadIndex()).filter((r) => r.patient === patient.id);
    if (token !== seq) return;
    const index = bench.index;
    if (!rows.length) {
      if (allowSwitch && index?.length) {
        const pool = harder(index.filter((r) => matches(r)));
        const from = pool.length ? pool : index;
        const row = from[Math.floor(Math.random() * from.length)];
        if (row) {
          await apply(row, token, `${firstName(patient)} has no questions in this dataset, so this one is for ${firstName(patientById(row.patient))}.`);
          return;
        }
      }
      bench.picking = false;
      pendingNote = `${firstName(patient)} has no questions in this dataset. Shuffle picks from all patients.`;
      setQuestion(null);
      return;
    }
    const matching = rows.filter((r) => matches(r));
    const row = bestOf(harder(matching.length ? matching : rows));
    if (!row) return;
    await apply(row, token, matching.length ? null : `No ${filterSummary()} questions for ${firstName(patient)}, so this is another one.`);
  } catch (error) {
    if (token !== seq) return;
    bench.picking = false;
    bench.pickError = error instanceof Error ? error.message : String(error);
    changed();
  }
}

/** Keep a question showing for the current patient (benchmark mode only). */
export function ensure({ allowSwitch }: { allowSwitch: boolean } = { allowSwitch: true }): void {
  const p = app.patient;
  if (app.mode !== 'benchmark' || !p || !app.cohort) return;
  if (app.question && app.question.patient !== p.id) void pickFor(p, { allowSwitch: false });
  else if (!app.question && !bench.cleared) void pickFor(p, { allowSwitch });
}

/** Retry after a load or pick error. */
export function retry(): void {
  bench.indexError = null;
  bench.pickError = null;
  changed();
  ensure({ allowSwitch: true });
}

/** A random question from the whole dataset that matches the filters (may switch patient). Returns what to announce. */
export async function shuffle(): Promise<string | null> {
  const token = ++seq;
  try {
    const all = await loadIndex();
    if (token !== seq) return null;
    const pool = harder(all.filter((r) => matches(r) && r.id !== app.question?.id));
    if (!pool.length) {
      bench.note = activeFilters().length ? 'No other question matches the filters. Clear filters to shuffle everything.' : 'No other question in this dataset.';
      changed();
      return null;
    }
    const row = pool[Math.floor(Math.random() * pool.length)];
    if (!row) return null;
    const switching = row.patient !== app.patient?.id;
    await apply(row, token, null);
    return `Shuffled: ${cap(row.label)}${switching ? `, for ${patientById(row.patient)?.name ?? 'another patient'}` : ''}.`;
  } catch (error) {
    if (token === seq) { bench.note = 'Could not shuffle: ' + (error instanceof Error ? error.message : String(error)); changed(); }
    return null;
  }
}

/** The next question for this patient that matches the filters (in name order, wrapping). */
export async function next(): Promise<void> {
  const p = app.patient;
  if (!p) return;
  const token = ++seq;
  try {
    const all = await loadIndex();
    if (token !== seq) return;
    const rows = all.filter((r) => r.patient === p.id && matches(r)).sort(byLabel);
    const at = rows.findIndex((r) => r.id === app.question?.id);
    const row = rows[(at + 1) % Math.max(rows.length, 1)];
    if (!row || row.id === app.question?.id) {
      bench.note = rows.length
        ? `This is the only ${activeFilters().length ? 'matching ' : ''}question for ${firstName(p)}. Shuffle searches all patients.`
        : `No ${filterSummary()} questions for ${firstName(p)}. Shuffle searches all patients.`;
      changed();
      return;
    }
    await apply(row, token, null);
  } catch (error) {
    if (token === seq) { bench.note = 'Could not load the next question: ' + (error instanceof Error ? error.message : String(error)); changed(); }
  }
}

/** Choose this row (from the browser); switches patient when it is another patient's. */
export async function choose(row: QuestionRow): Promise<void> {
  const token = ++seq;
  await apply(row, token, null);
}

export function clearQuestion(): void {
  ++seq;
  bench.picking = false;
  bench.cleared = true;
  pendingNote = null;
  setQuestion(null);
}

export function setFilters(next: Filters): void {
  bench.filters = next;
  storage.set('bench-filters', next);
  changed();
}
export function setSort(sort: Sort): void {
  bench.sort = sort;
  storage.set('bench-sort', sort);
  changed();
}
export function setScope(scope: Scope): void {
  bench.scope = scope;
  storage.set('bench-scope', scope);
  changed();
}

// ---------- wiring (once, at import) ----------

on('ready', () => {
  void loadIndex().catch(() => {});
  ensure({ allowSwitch: true });
});
on('mode', (mode) => {
  if (mode === 'benchmark') { bench.cleared = false; ensure({ allowSwitch: true }); }
  changed();
});
on('patient', () => {
  // A question chosen for another patient switches patient itself (setQuestion); a patient the
  // user picked gets a replacement question.
  ensure({ allowSwitch: false });
  changed();
});
on('question', () => {
  bench.note = pendingNote;
  pendingNote = null;
  changed();
});
