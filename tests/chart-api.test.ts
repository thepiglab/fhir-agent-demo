// The Chart assistant's /api routes (src/chart/api.ts) over the real exported data in
// public/data/, with fetch stubbed to read those files. No model: this covers the cohort-aware
// views, the FHIR console with its sandbox (a write, then Reset), the tool-argument checks, and
// grading a benchmark episode with the ported scorer from the task's own reference steps.
import { readFileSync, existsSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { argumentError, grade, handle, goldEvidence } from '../src/chart/api.ts';
import { chooseCohort, fetchData, ensureEnv, setDataBase, activeCohort } from '../src/chart/data.ts';
import type { TaskRow } from '../src/chart/data.ts';
import { pyDumps } from '../src/fhir/pyjson.ts';
import { episodeStore } from '../src/fhir/store.ts';
import type { Rec } from '../src/fhir/pyrt.ts';

const PUBLIC = new URL('../public/', import.meta.url);
const FIXTURES = new URL('fixtures/', import.meta.url);
/** Test-only data (the dev-patient sets, kept out of the deployed site) wins, then the site's public/. */
const dataFile = (path: string): URL => {
  const fixture = new URL(path, FIXTURES);
  return existsSync(fixture) ? fixture : new URL(path, PUBLIC);
};
const BASE = 'http://demo.test/';
const haveData = existsSync(new URL('data/cohorts.json', PUBLIC));

interface PatientInfo { id: string; ref: string; shard_sha: string }
interface Fact { field: string; text?: string }
/** The fields of the routes' replies that these tests read (all routes share one loose shape). */
interface Reply {
  cohort: string; patients: PatientInfo[]; changes: number; status: number; ok: boolean; ref: string;
  body: { id: string }; readable: { facts: Fact[] }; tasks: { prompt: unknown; family: unknown; purpose: unknown; task_type: unknown }[];
}
interface Step { method: string; path?: string; body?: unknown; headers?: Record<string, string> }
async function call(path: string, payload: object = {}): Promise<{ status: number; json: Reply }> {
  const res = await handle(path, { method: 'POST', body: JSON.stringify(payload) });
  return { status: res.status, json: (await res.json()) as Reply };
}

describe.skipIf(!haveData)('chart api on the exported data', () => {
  let patient: PatientInfo;
  let own: string;
  beforeAll(() => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input), BASE);
      const file = dataFile(url.pathname.slice(1));
      return existsSync(file) ? new Response(readFileSync(file)) : new Response('missing', { status: 404 });
    });
    setDataBase(BASE + 'data/');
    chooseCohort('natural-v0.2.3-heldout');
  });

  it('lists the cohort and its patients', async () => {
    const cohorts = await fetchData<{ id: string }[]>('cohorts.json');
    expect(cohorts.map((c) => c.id)).toContain('natural-v0.2.3-heldout');
    expect((await activeCohort()).id).toBe('natural-v0.2.3-heldout');
    const { status, json } = await call('/api/patients');
    expect(status).toBe(200);
    expect(json.cohort).toBe('natural-v0.2.3-heldout');
    expect(json.patients.length).toBe(228);
    patient = json.patients[0];
    own = patient.ref;
    expect(patient.shard_sha).toMatch(/^[0-9a-f]{12}$/);
  });

  it('serves summary, chart and a record view with zero changes', async () => {
    for (const route of ['/api/summary', '/api/chart']) {
      const { status, json } = await call(route, { patient: patient.id });
      expect(status).toBe(200);
      expect(json.changes).toBe(0);
    }
    const chart = await fetchData<{ views: Record<string, unknown> }>(`charts/${patient.shard_sha}/${patient.id}.json`);
    const key = Object.keys(chart.views).find((k) => k.startsWith('Task/'))!;
    const { json } = await call('/api/resource', { patient: patient.id, ref: key });
    expect(json.ref).toBe(key);
    expect(json.readable.facts.length).toBeGreaterThan(0);
    expect((await call('/api/resource', { patient: patient.id, ref: 'Task/nope' })).status).toBe(404);
    expect((await call('/api/summary', { patient: 'nobody' })).status).toBe(404);
  });

  it('returns the same resource view when production data omits the embedded record', async () => {
    const chart = await fetchData<{ views: Record<string, Rec> }>(`charts/${patient.shard_sha}/${patient.id}.json`);
    const key = Object.keys(chart.views).find((k) => k.startsWith('Task/'))!;
    const before = await call('/api/resource', { patient: patient.id, ref: key });
    const embedded = chart.views[key].resource;
    try {
      delete chart.views[key].resource;
      expect(await call('/api/resource', { patient: patient.id, ref: key })).toEqual(before);
    } finally {
      chart.views[key].resource = embedded;
    }
  });

  it('lists the patient\'s benchmark questions with their prompts', async () => {
    const { json } = await call('/api/benchmark', { patient: patient.id });
    expect(json.tasks.length).toBeGreaterThan(5);
    expect(json.tasks[0]).toMatchObject({ family: expect.any(String), purpose: expect.any(String), task_type: expect.any(String) });
    expect(json.tasks.every((t) => typeof t.prompt === 'string' && t.prompt.length > 0)).toBe(true);
  });

  it('reads through the console, writes in the sandbox, and resets', async () => {
    const read = await call('/api/fhir', { patient: patient.id, method: 'GET', path: `Patient/${patient.id}` });
    expect(read.json.status).toBe(200);
    expect(read.json.changes).toBe(0);
    // The write needs the FHIR schema and contracts the page loads before the first write.
    const created = await call('/api/fhir', {
      patient: patient.id, method: 'POST', path: 'Task',
      body: { resourceType: 'Task', status: 'requested', intent: 'order', description: 'Call the patient', for: { reference: own } },
    });
    expect(created.json.status).toBe(201);
    expect(created.json.changes).toBe(1);
    const newRef = `Task/${created.json.body.id}`;
    expect((await call('/api/summary', { patient: patient.id })).json.changes).toBe(1);
    const view = await call('/api/resource', { patient: patient.id, ref: newRef });
    expect(view.status).toBe(200);
    expect(view.json.readable.facts.some((f) => f.field === 'description' && f.text === 'Call the patient')).toBe(true);
    expect(view.json.changes).toBe(1);
    // An update with the current version, in the same sandbox.
    const updated = await call('/api/fhir', {
      patient: patient.id, method: 'PUT', path: newRef, if_match: 'W/"1"',
      body: { ...created.json.body, status: 'completed' },
    });
    expect(updated.json.status).toBe(200);
    expect(updated.json.changes).toBe(2);
    expect((await call('/api/resource', { patient: patient.id, ref: newRef })).json.readable.facts.find((f) => f.field === 'status')?.text).toBe('completed');
    // Bad method / path are refused as the Python console refuses them.
    expect((await call('/api/fhir', { patient: patient.id, method: 'PATCH', path: 'x' })).status).toBe(400);
    expect((await call('/api/fhir', { patient: patient.id, method: 'GET', path: 3 })).status).toBe(400);
    // Reset discards the sandbox.
    expect((await call('/api/reset', { patient: patient.id })).json).toEqual({ ok: true, changes: 0 });
    expect((await call('/api/summary', { patient: patient.id })).json.changes).toBe(0);
    expect((await call('/api/resource', { patient: patient.id, ref: newRef })).status).toBe(404);
    const again = await call('/api/fhir', { patient: patient.id, method: 'GET', path: newRef });
    expect(again.json.status).toBe(404);
    expect(again.json.changes).toBe(0);
  });

  it('switches cohort; developer-only sets only in the developer view', async () => {
    chooseCohort('natural-v0.2.2');
    const original = globalThis.localStorage;
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    expect((await call('/api/patients')).json.cohort).toBe('natural-v0.2.3-heldout');  // developer view off
    localStorage.setItem('fhir-demo-dev', 'true');
    try {
      expect((await call('/api/patients')).json.cohort).toBe('natural-v0.2.2');
    } finally {
      localStorage.removeItem('fhir-demo-dev');
      chooseCohort('natural-v0.2.3-heldout');
      vi.stubGlobal('localStorage', original);
    }
  });

  it('offers example questions only where the chart answers them, a trend only with six points', async () => {
    const cohort = await activeCohort();
    expect(cohort.default).toBe(true);
    const { patients } = await fetchData<{ patients: (PatientInfo & { as_of: string })[] }>(`${cohort.id}/patients.json`);
    expect(patients.some((p) => p.id === cohort.featured_patient)).toBe(true);
    let trends = 0;
    for (const p of patients) {
      const { summary } = await fetchData<{ summary: { suggestions: { voice: string; question: string; negative: boolean }[] } }>(`charts/${p.shard_sha}/${p.id}.json`);
      for (const voice of ['physician', 'nurse', 'clerical']) {
        const shown = summary.suggestions.filter((q) => q.voice === voice).slice(0, 3);
        expect(shown.some((q) => q.negative), `${p.id} ${voice}`).toBe(true);
      }
      if (!summary.suggestions.some((q) => q.question.startsWith('Chart '))) continue;
      trends += 1;
      const { resources } = await fetchData<{ resources: Rec[] }>(`shards/${p.shard_sha}.json`);
      const year = new Date(Date.parse(p.as_of) - 365 * 864e5).toISOString().slice(0, 10);
      const points = resources.filter((r) => r.resourceType === 'Observation' && (r.subject as Rec | undefined)?.reference === p.ref
        && JSON.stringify(r.code).includes('"718-7"') && r.valueQuantity && String(r.effectiveDateTime).slice(0, 10) >= year);
      expect(points.length, p.id).toBeGreaterThanOrEqual(6);
    }
    expect(trends).toBeGreaterThan(0);
    expect((await fetchData<{ summary: { suggestions: { question: string }[] } }>(
      `charts/${patients.find((p) => p.id === cohort.featured_patient)!.shard_sha}/${cohort.featured_patient}.json`,
    )).summary.suggestions[0]!.question).toMatch(/^Chart /);
  });

  it('gives a patient one as-of date in every cohort, the one its chart and examples use', async () => {
    const cohorts = await fetchData<{ id: string }[]>('cohorts.json');
    for (const c of cohorts) {
      const { patients } = await fetchData<{ patients: (PatientInfo & { as_of: string })[] }>(`${c.id}/patients.json`);
      for (const p of patients) {
        const chart = await fetchData<{ patient: { as_of: string }; summary: { as_of: string } }>(`charts/${p.shard_sha}/${p.id}.json`);
        expect([chart.patient.as_of, chart.summary.as_of], `${c.id} ${p.id}`).toEqual([p.as_of, p.as_of]);
      }
    }
  });

  it('checks tool arguments as FastMCP does', () => {
    expect(argumentError('fhir_request', { method: 'GET', path: 'Patient' })).toBeNull();
    expect(argumentError('fhir_request', { method: 'GET', path: 'Patient', body: {} })).toBeNull();
    expect(argumentError('fhir_request', {})).toBe(
      'Error executing tool fhir_request: 2 validation errors for fhir_requestArguments\n'
      + 'method\n  Field required [type=missing, input_value={}, input_type=dict]\n'
      + '    For further information visit https://errors.pydantic.dev/2.13/v/missing\n'
      + 'path\n  Field required [type=missing, input_value={}, input_type=dict]\n'
      + '    For further information visit https://errors.pydantic.dev/2.13/v/missing');
    expect(argumentError('fhir_request', { method: 5, path: 'x' })).toBe(
      'Error executing tool fhir_request: 1 validation error for fhir_requestArguments\n'
      + 'method\n  Input should be a valid string [type=string_type, input_value=5, input_type=int]\n'
      + '    For further information visit https://errors.pydantic.dev/2.13/v/string_type');
    expect(argumentError('fhir_request', { method: 'GET', path: 'Patient', body: 'y'.repeat(80) })).toContain(
      "input_value='yyyyyyyyyyyyyyyyyyyyyyyy...yyyyyyyyyyyyyyyyyyyyyyy', input_type=str]");
    expect(argumentError('fhir_request', { method: 'GET', path: 'Patient', body: null })).toContain('input_value=None, input_type=NoneType');
  });

  it('grades a benchmark episode with the ported scorer (reference steps pass)', async () => {
    await ensureEnv();
    const cohort = await activeCohort();
    const picked: TaskRow[] = [];
    for (const p of (await fetchData<{ patients: PatientInfo[] }>(`${cohort.id}/patients.json`)).patients.slice(0, 6)) {
      const { tasks } = await fetchData<{ tasks: TaskRow[] }>(`${cohort.id}/tasks/${p.id}.json`);
      const readOnly = tasks.find((t) => t._display.read_only && Array.isArray(t.reference_steps));
      const write = tasks.find((t) => !t._display.read_only && Array.isArray(t.reference_steps));
      for (const t of [readOnly, write]) if (t && picked.length < 8) picked.push(t);
    }
    expect(picked.some((t) => !t._display.read_only)).toBe(true);
    const outcomes: [string, unknown][] = [];
    let writes = 0;
    for (const task of picked) {
      const shard = await fetchData<{ resources: Rec[] }>(`shards/${(await fetchData<{ patients: PatientInfo[] }>(`${cohort.id}/patients.json`)).patients.find((p) => p.id === task.patient_id)!.shard_sha}.json`);
      const store = episodeStore(task, shard.resources, 40, 'v0.5');
      for (const step of task.reference_steps as Step[]) {
        store.active_tool = 'fhir_request';
        store.agent_tools.push('fhir_request');
        store.fhirRequestObject({ method: step.method, path: step.path ?? '', body: step.body, if_match: step.headers?.['If-Match'] ?? '', if_none_exist: step.headers?.['If-None-Exist'] ?? '' });
      }
      const final = pyDumps({ answer: task.gold.answer, evidence: goldEvidence(task) });
      const result = grade(cohort, task, store, final);
      expect(result.error).toBeUndefined();
      outcomes.push([`${task.family}${task._display.read_only ? '' : ' (writes)'}`, result.metrics?.workflow_success]);
      if (task._display.read_only) expect(result.audit).toEqual([]);
      else writes += result.audit.length;
      // A wrong answer on the same episode fails.
      const wrong = grade(cohort, task, store, pyDumps({ answer: { nope: 1 }, evidence: [] }));
      expect(wrong.metrics?.workflow_success).toBeFalsy();
    }
    expect(writes).toBeGreaterThan(0);
    expect(outcomes.filter(([, ok]) => ok).length, JSON.stringify(outcomes)).toBe(outcomes.length);
  });
});
