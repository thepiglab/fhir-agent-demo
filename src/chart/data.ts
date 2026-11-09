// The exported site data (public/data/): lazy, cached JSON loads, the benchmark cohorts, and the
// two things the Chart assistant's modules share, the chosen cohort and the chosen question.
//
// Layout (written by the fhir-env repo's scripts/web_demo/export_chart_site.py):
//   config.json, cohorts.json
//   shards/<sha12>.json              {sha, resources, cards, inputs}   one chart shard, shared by cohorts
//   charts/<sha12>/<patient>.json    {patient, summary, chart, views}
//   <cohort>/patients.json           {patients: [... shard_sha]}
//   <cohort>/questions.json          one index row per task, for the picker
//   <cohort>/tasks/<patient>.json    {tasks: [raw task rows + _display]}
//   env/                             the FHIR JSON schema and resource contracts (setEnvData)

import { loadEnvData, pyParse } from '../fhir/fhir_store.ts';
import type { FhirResource } from '../types.ts';

export interface Cohort {
  id: string;
  label: string;
  tasks: number;
  patients: number;
  read_only_tasks: number;
  write_tasks: number;
  families: number;
  /** API-style prompts (keyed, clinical suites): listed only in the developer view. */
  technical?: boolean;
  /** The set the page opens with (the exporter marks the natural release it was given). */
  default?: boolean;
  /** A patient to open first: one whose chart answers every example question, the trend included. */
  featured_patient?: string | null;
  [key: string]: unknown;
}

/** A raw task row (the evaluator's case) plus the exporter's _display. Floats are PyFloat. */
export type TaskRow = {
  id: string;
  family: string;
  patient_id: string;
  prompt: string;
  omit: string[];
  writable_types: string[];
  delete_refs: string[];
  writable_refs?: string[];
  gold: Record<string, unknown>;
  track?: string | null;
  persona?: string | null;
  style?: string | null;
  premise?: boolean | null;
  _display: { label: string; purpose: string; task_type: string; tier: string | null; read_only: boolean };
  [key: string]: unknown;
};

/** One row of <cohort>/questions.json. */
export interface QuestionRow {
  id: string;
  patient: string;
  family: string;
  label: string;
  purpose: string;
  task_type: string;
  tier: string | null;
  track: string | null;
  persona: string | null;
  style: string | null;
  premise: string | boolean | null;
  read_only: boolean;
  crud: string | null;
  reference_calls: number | null;
  /** Release tags, where the release has them (natural v0.2.3 on): shown and filterable. */
  /** Structural difficulty: easy, medium or hard. */
  difficulty?: string | null;
  specialty?: string | null;
  subspecialty?: string | null;
  /** Teacher-measured (dev) or estimated bin: easy, medium, hard, unsolved or unmeasured. */
  difficulty_empirical?: string | null;
  /** Unsolved by every teacher. */
  stretch?: boolean | null;
  /** One-search lookup (the release's easy slice). */
  single_hop?: boolean | null;
  /** A negative (the answer is "no" / "not in the chart"), its kind, and whether the kind is new in v0.2.3. */
  negative?: boolean | null;
  negative_kind?: string | null;
  negative_new?: boolean | null;
}

export interface ShardFile {
  sha: string;
  resources: FhirResource[];
  cards: Record<string, Record<string, unknown>>;
  inputs?: { names: Record<string, string>; cards: Record<string, [string | null, string, string]> };
}

// --- where the files are ----------------------------------------------------------------------

let base: URL | null = null;
/** Tests point the loader at another place; the page uses public/data/ beside it. */
export function setDataBase(url: string | URL): void { base = new URL(url); cache.clear(); }
export function dataUrl(path: string): URL {
  if (!base) base = new URL(`${import.meta.env.BASE_URL}data/`, globalThis.location?.href ?? 'http://localhost/');
  return new URL(path, base);
}

/** The chart data is generated, not hand-written: say how to get it. */
function missing(path: string): string {
  return `The chart data is missing (data/${path}). Generate public/data/ with the fhir-env repo's `
    + 'scripts/web_demo/export_chart_site.py (see README, "Chart data") or use a bundle that includes it.';
}

const cache = new Map<string, Promise<unknown>>();
/** One JSON file, parsed once with floats kept (13.0 stays 13.0, as the model saw it). */
export function fetchData<T>(path: string): Promise<T> {
  let entry = cache.get(path);
  if (!entry) {
    entry = fetch(dataUrl(path)).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 404 ? missing(path) : `${path}: ${r.status}`);
      const text = await r.text();
      // Static hosts and the dev server answer a missing file with the HTML page itself.
      if (/^\s*</.test(text)) throw new Error(missing(path));
      return pyParse(text);
    });
    entry.catch(() => cache.delete(path));
    cache.set(path, entry);
  }
  return entry as Promise<T>;
}

let envLoaded: Promise<void> | null = null;
/** The FHIR schema and contracts, fetched once; the store needs them before any write. */
export function ensureEnv(): Promise<void> {
  if (!envLoaded) {
    envLoaded = loadEnvData(dataUrl('env/').href);
    envLoaded.catch(() => { envLoaded = null; });
  }
  return envLoaded;
}

// --- cohorts -----------------------------------------------------------------------------------

export const cohortList = (): Promise<Cohort[]> => fetchData<Cohort[]>('cohorts.json');

const STORE_KEY = 'fhir-demo-cohort';
function remembered(): string | null {
  try { return globalThis.localStorage?.getItem(STORE_KEY) ?? null; } catch { return null; }
}
/** The wanted cohort: ?cohort= in the URL, else the last choice ('' for none: the default). */
export function wantedCohort(): string {
  const fromUrl = globalThis.location ? new URLSearchParams(globalThis.location.search).get('cohort') : null;
  return fromUrl || remembered() || '';
}
let override: string | null = null;
/** Remember a choice (tests set one directly; the page reloads after choosing). */
export function chooseCohort(id: string): void {
  override = id;
  try { globalThis.localStorage?.setItem(STORE_KEY, id); } catch { /* storage unavailable */ }
  if (globalThis.location && globalThis.history) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('cohort', id);
    globalThis.history.replaceState(null, '', url);
  }
}
function developerView(): boolean {
  try { return JSON.parse(globalThis.localStorage?.getItem('fhir-demo-dev') ?? 'false') === true; } catch { return false; }
}
/** The export's default set: the one it marks, else the first non-technical one. Swapping the
 *  natural release (export_chart_site.py --release) needs no change here. */
export function defaultCohort(all: Cohort[]): Cohort | undefined {
  return all.find((c) => c.default) ?? all.find((c) => !c.technical) ?? all[0];
}
/** The cohort in use: the wanted one if the export has it, else the default set. */
export async function activeCohort(): Promise<Cohort> {
  const all = await cohortList();
  const id = override ?? wantedCohort();
  const fallback = defaultCohort(all);
  let found = all.find((c) => c.id === id) ?? fallback;
  // Technical (API-style) sets are listed only in the developer view; outside it, the natural set.
  if (found?.technical && !developerView()) found = fallback ?? found;
  if (!found) throw new Error('No benchmark cohorts were exported');
  return found;
}

// --- the benchmark question the page has chosen -------------------------------------------------

/** Set by the picker (benchmark.ts), read when a question is asked: the exact task to grade. */
export const selection: { taskId: string | null } = { taskId: null };
