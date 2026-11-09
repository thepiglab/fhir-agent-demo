// Golden parity corpus for the TypeScript FHIR store and scorer.
//
// corpus.jsonl.gz is written by the fhir-env repo's scripts/web_demo/make_parity_corpus.py with
// the canonical Python environment (source-manifest.json names the commit). Each episode lists
// the fhir_request calls made, the sha256 of each exact response, the final chart state and
// every metric evaluate_training returned. The TypeScript port replays the same calls and must
// match.
//
// The tasks and chart shards come from the benchmark data roots, mapped by cohort id in
// tests/parity/roots.local.json (git-ignored) or the FHIR_PARITY_ROOTS environment variable
// (JSON). Without them the parity tests are skipped, and say so.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pyParse } from '../../src/fhir/pyjson.ts';
import type { FhirResource } from '../../src/types.ts';

const HERE = new URL('./', import.meta.url);

/** One recorded fhir_request: the arguments passed to fhir_request_object, and its response. */
export interface CorpusCall {
  turn: number;
  args: { method: string; path: string; body: unknown; if_match: string; if_none_exist: string };
  sha?: string;
  len?: number;
  output?: string;
  raised?: string;
}

export interface Episode {
  id: string;
  source: string;
  cohort: string;
  task_id: string;
  calls: CorpusCall[];
  final: string;
  state: { sha: string; resources: number; audit: number; deleted: string[]; events: number };
  metrics: Record<string, number | boolean | null>;
}

export interface CorpusInfo {
  episodes: number;
  by_source: Record<string, number>;
  options: { efficiency_weight: number; answer_mode: string; retrieval_weight: number; reward_mode: string; interface: string; scoring_version: string };
  max_calls: number;
}

/** A task row exactly as tasks.jsonl holds it (the environment's "case"). */
export type Task = Record<string, unknown> & {
  id: string; family: string; patient_id: string; shard: string; omit: string[];
  writable_types: string[]; delete_refs: string[]; writable_refs?: string[];
  gold: Record<string, unknown>;
};

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function corpusInfo(): CorpusInfo {
  return JSON.parse(readFileSync(new URL('corpus-info.json', HERE), 'utf8')) as CorpusInfo;
}

/** Episodes in file order; PARITY_SAMPLE=n keeps every n-th one for a quick run. */
export function episodes(): Episode[] {
  const text = gunzipSync(readFileSync(new URL('corpus.jsonl.gz', HERE))).toString('utf8');
  const all = text.split('\n').filter(Boolean).map((line) => pyParse<Episode>(line));
  const every = Number(process.env.PARITY_SAMPLE || 1);
  return every > 1 ? all.filter((_, i) => i % every === 0) : all;
}

function roots(): Record<string, string> | null {
  if (process.env.FHIR_PARITY_ROOTS) return JSON.parse(process.env.FHIR_PARITY_ROOTS) as Record<string, string>;
  const local = new URL('roots.local.json', HERE);
  return existsSync(local) ? JSON.parse(readFileSync(local, 'utf8')) as Record<string, string> : null;
}

/** Why the parity data is unavailable, or null when every cohort root is present. */
export function missingData(): string | null {
  const r = roots();
  if (!r) return 'no data roots: create tests/parity/roots.local.json or set FHIR_PARITY_ROOTS';
  for (const [cohort, root] of Object.entries(r)) {
    if (!existsSync(`${root}/dev/tasks.jsonl`)) return `cohort ${cohort}: ${root}/dev/tasks.jsonl not found`;
  }
  return null;
}

const taskCache = new Map<string, Map<string, Task>>();
const shardCache = new Map<string, FhirResource[]>();

/** The task row for an episode, parsed like Python (floats stay PyFloat). */
export function task(cohort: string, id: string): Task {
  let byId = taskCache.get(cohort);
  if (!byId) {
    const root = roots()![cohort];
    const lines = readFileSync(`${root}/dev/tasks.jsonl`, 'utf8').split('\n').filter(Boolean);
    byId = new Map(lines.map((l) => { const t = pyParse<Task>(l); return [t.id, t]; }));
    taskCache.set(cohort, byId);
  }
  const found = byId.get(id);
  if (!found) throw new Error(`task ${id} not in cohort ${cohort}`);
  return found;
}

/** A shard's resources in file order, parsed like Python. Cached: callers must copy before writing. */
export function shard(cohort: string, path: string): FhirResource[] {
  const root = roots()![cohort];
  const key = `${root}/${path}`;
  let resources = shardCache.get(key);
  if (!resources) {
    resources = readFileSync(key, 'utf8').split('\n').filter(Boolean).map((l) => pyParse<FhirResource>(l));
    shardCache.set(key, resources);
  }
  return resources;
}
