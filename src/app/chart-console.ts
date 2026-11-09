// The chart panel's Console tab (developer mode): send FHIR requests to the patient's sandbox
// copy of the chart and read the store's response. Writes change only this browser's copy;
// after one, the panel learns the new change count through the `sandbox` event.
import { h, fill, svg, highlight, plural, announce } from './dom.ts';
import { ICON } from './icons.ts';
import { app, api, emit, isRef } from './state.ts';
import type { ConsoleRequest, ConsoleResult } from './chart-types.ts';

export interface ConsoleHooks {
  /** Open a record in the Record tab. */
  open(ref: string): void;
  /** The change count the panel last saw (to tell whether a write changed the sandbox). */
  knownChanges(): number;
}

const mrnSystem = (): string => String(app.config?.['mrn_system'] ?? '');

/** A search of this patient's records of one type, newest first where the type has dates. */
export function searchPath(type: string): string | null {
  const p = app.patient;
  if (!p) return null;
  const params = app.config?.search_params[type] ?? [];
  if (type === 'Patient') return p.ref;
  if (!params.includes('patient')) return null;
  return `${type}?patient=${p.id}` + (params.includes('date') ? '&_sort=-date' : '') + '&_count=10';
}
const patientQuery = (): string => {
  const p = app.patient;
  if (!p) return '';
  return p.mrn ? `Patient?identifier=${mrnSystem()}|${p.mrn}` : p.ref;
};

let hooks: ConsoleHooks;
const state = { history: [] as string[], opened: false, seq: 0 };

// The form, built once.
const method = h('select', { class: 'cp-method', 'aria-label': 'Method' }, ['GET', 'POST', 'PUT', 'DELETE'].map((m) => h('option', { value: m }, m)));
const path = h('input', { class: 'mono cp-path', spellcheck: 'false', autocomplete: 'off', placeholder: 'Observation?patient=…&_sort=-date', 'aria-label': 'Relative FHIR path' });
const bodyField = h('textarea', { class: 'mono cp-body', rows: 7, spellcheck: 'false', placeholder: 'Request body (JSON), e.g. {"resourceType": "Task", …}', 'aria-label': 'Request body' });
const ifMatch = h('input', { class: 'mono', placeholder: 'If-Match, e.g. W/"1"', 'aria-label': 'If-Match header', spellcheck: 'false' });
const ifNoneExist = h('input', { class: 'mono', placeholder: 'If-None-Exist, e.g. identifier=system|value', 'aria-label': 'If-None-Exist header', spellcheck: 'false' });
const bodyWrap = h('label', { class: 'cp-field' }, h('span', { class: 'eyebrow' }, 'Body'), bodyField);
const ifMatchWrap = h('label', { class: 'cp-field' }, h('span', { class: 'eyebrow' }, 'If-Match'), ifMatch);
const ifNoneWrap = h('label', { class: 'cp-field' }, h('span', { class: 'eyebrow' }, 'If-None-Exist'), ifNoneExist);
const writeFields = h('div', { class: 'cp-write', hidden: true }, bodyWrap, h('div', { class: 'cp-write-row' }, ifMatchWrap, ifNoneWrap),
  h('p', { class: 'cp-note' }, svg(ICON.lock), "Writes change only this browser's private copy of the chart. Reset brings back the original."));
const quick = h('div', { class: 'cp-chips', role: 'group', 'aria-label': 'Quick requests' });
const responseHead = h('div', { class: 'cp-response-head' });
const response = h('pre', { class: 'json cp-response' });

function setMethod(m: string): void {
  method.value = m;
  writeFields.hidden = m === 'GET';
  bodyWrap.hidden = !(m === 'POST' || m === 'PUT');
  ifMatchWrap.hidden = m === 'GET';
  ifNoneWrap.hidden = m !== 'POST';
}
method.addEventListener('change', () => setMethod(method.value));

const form = h('form', { class: 'cp-console-form', onsubmit: (event: SubmitEvent) => { event.preventDefault(); void run({ method: method.value, path: path.value.trim() }); } },
  method, path, h('button', { type: 'submit', class: 'btn primary' }, 'Send'));

export const consoleView: HTMLElement = h('div', { class: 'cp-console' },
  form, writeFields,
  h('div', { class: 'cp-quick' }, h('span', { class: 'eyebrow' }, 'Try'), quick),
  h('div', { class: 'cp-response-card' }, responseHead, response));

export function initConsole(h_: ConsoleHooks): void {
  hooks = h_;
  setMethod('GET');
  idle();
}

function idle(): void {
  fill(responseHead, h('span', { class: 'muted small' }, "Responses come from this chart's FHIR store, running in your browser."));
  response.hidden = true;
}

function renderQuick(): void {
  const p = app.patient;
  if (!p) { quick.replaceChildren(); return; }
  const items: [string, string][] = [
    ['Patient by MRN', patientQuery()],
    ['Latest observations', `Observation?patient=${p.id}&_sort=-date&_count=10`],
    ['Reports + results', `DiagnosticReport?patient=${p.id}&_include=DiagnosticReport:result&_count=10`],
    ['Active orders', `ServiceRequest?patient=${p.id}&status=active`],
    ['Active prescriptions', `MedicationRequest?patient=${p.id}&status=active`],
    ['Capabilities', 'metadata'],
  ];
  fill(quick, items.map(([label, q]) => h('button', { type: 'button', class: 'chip', title: 'GET ' + q, onclick: () => void run({ method: 'GET', path: q }) }, label)));
}

/** A new patient: forget the history and the response. */
export function consoleOnPatient(): void {
  state.history = [];
  state.opened = false;
  state.seq += 1;
  path.value = '';
  renderQuick();
  idle();
}
/** The tab is shown: the first time per patient, look the patient up. */
export function consoleOnShow(): void {
  if (!app.patient || state.opened) return;
  state.opened = true;
  renderQuick();
  void run({ method: 'GET', path: patientQuery() });
}
/** The sandbox was reset: show the last GET again, as the store now answers it. */
export function consoleAfterReset(): void {
  if (!state.opened || !app.patient) return;
  void run({ method: 'GET', path: state.history[state.history.length - 1] ?? app.patient.ref }, { record: false });
}

function bundleSummary(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as { resourceType?: string; type?: string; total?: number; entry?: unknown[]; issue?: { diagnostics?: string }[]; id?: string };
  if (b.resourceType === 'Bundle') {
    const entries = (b.entry ?? []).length;
    return `Bundle ${b.type ?? ''}${b.total !== undefined ? ` · total ${b.total}` : ''} · ${entries} entr${entries === 1 ? 'y' : 'ies'}`;
  }
  if (b.resourceType === 'OperationOutcome') return (b.issue ?? []).map((i) => i.diagnostics).filter(Boolean).join('; ');
  return b.id ? `${b.resourceType}/${b.id}` : b.resourceType ?? '';
}

function backButton(): HTMLButtonElement {
  return h('button', { type: 'button', class: 'btn ghost icon sm', title: 'Previous GET', 'aria-label': 'Previous GET', disabled: state.history.length < 2,
    onclick: () => {
      if (state.history.length < 2) return;
      state.history.pop();
      void run({ method: 'GET', path: state.history[state.history.length - 1] ?? '' }, { record: false });
    } }, svg(ICON.arrowLeft));
}
function showError(message: string): void {
  fill(responseHead, backButton(), h('span', { class: 'badge err' }, 'Error'), h('span', { class: 'small cp-response-text' }, message));
  response.hidden = true;
}

/** Send a request (filling the form with it). Links in a response browse the console. */
export async function run(request: ConsoleRequest, { record = true } = {}): Promise<void> {
  const patient = app.patient;
  if (!patient) return;
  state.opened = true;
  const m = (request.method ?? 'GET').toUpperCase();
  setMethod(m);
  path.value = request.path;
  if (request.body !== undefined) bodyField.value = request.body ? JSON.stringify(request.body, null, 2) : '';
  if (request.if_match !== undefined) ifMatch.value = request.if_match;
  if (request.if_none_exist !== undefined) ifNoneExist.value = request.if_none_exist;
  let body: unknown = null;
  if (m === 'POST' || m === 'PUT') {
    const text = bodyField.value.trim();
    if (text) {
      try { body = JSON.parse(text); } catch (e) { showError('Body is not valid JSON: ' + (e instanceof Error ? e.message : String(e))); return; }
    }
  }
  const seq = ++state.seq;
  fill(responseHead, backButton(), h('span', { class: 'spinner' }), h('span', { class: 'muted small mono cp-response-text' }, `${m} ${request.path || '(root)'}`));
  try {
    const result = await api<ConsoleResult>('/api/fhir', {
      patient: patient.id, method: m, path: request.path, body,
      if_match: m === 'GET' ? '' : ifMatch.value.trim(), if_none_exist: m === 'POST' ? ifNoneExist.value.trim() : '',
    });
    if (seq !== state.seq || app.patient?.id !== patient.id) return;
    if (record && m === 'GET') state.history.push(request.path);
    const headers = Object.entries(result.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('   ');
    const shown = (result.body ?? {}) as { resourceType?: string; id?: string };
    const single = result.status < 300 && shown.id && isRef(`${shown.resourceType}/${shown.id}`) ? `${shown.resourceType}/${shown.id}` : null;
    const ok = result.status < 300;
    fill(responseHead,
      backButton(),
      h('span', { class: `badge ${ok ? 'ok' : 'err'}` }, String(result.status)),
      h('span', { class: 'badge' }, m),
      h('span', { class: 'small cp-response-text', title: headers || undefined }, bundleSummary(result.body)),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted xs nowrap' }, `${result.ms} ms`),
      single ? h('button', { type: 'button', class: 'btn ghost sm', title: `What ${single} says and how it links`, onclick: () => hooks.open(single) }, 'Open record') : null,
      h('button', { type: 'button', class: 'btn ghost icon sm', title: 'Copy the response', 'aria-label': 'Copy the response',
        onclick: () => { void navigator.clipboard?.writeText(JSON.stringify(result.body, null, 2)); announce('Copied.'); } }, svg(ICON.copy)));
    response.hidden = false;
    response.innerHTML = result.body === null || result.body === undefined ? '<span class="muted">(no body)</span>' : highlight(JSON.stringify(result.body, null, 2), isRef);
    response.scrollTop = 0;
    if (result.changes !== hooks.knownChanges()) {
      if (m !== 'GET') announce(`The chart copy now has ${plural(result.changes, 'change')}.`);
      emit('sandbox', { patient: patient.id, changes: result.changes });
    }
  } catch (error) {
    if (seq === state.seq) showError(error instanceof Error ? error.message : String(error));
  }
}
