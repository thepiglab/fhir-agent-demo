// The landing page (index.html): one primary action that flows into the Chart assistant. If the
// model is in this browser it opens chart.html at once; if not, it downloads it here with a clear
// progress bar and then opens chart.html by itself. Model details (facts, source, a local GGUF,
// removing the weights, this device) sit in a quiet disclosure.
//
// ?simple=1 keeps the self-test page instead: its own small chart and ask cards, whose agent loop
// has LFM3 call fhir_request against the in-browser FhirStore. scripts/bench_chrome.ts drives it
// (with &autoload=1) through window.demoState, window.demoMetrics, window.runBench and #model-state.
import { fetchDataJson, fetchDataText } from '../app/datafile.ts';
import '../app/tokens.css';
import '../styles/model-page.css';
import { MODEL_FACTS, MODEL_FILE } from '../model/config.ts';
import type { Model } from '../model/model.ts';
import type { ModelStatus } from '../app/state.ts';
import { FhirStore, pyDumps, pyParse, ref } from '../fhir/fhir_store.ts';
import { parseFinal } from '../agent/chat.ts';
import type { ChatMessage, GenerateOptions, Tool } from '../../vendor/lfm3-webgpu-pi/Lfm3ForCausalLM.js';
import type { FhirResource } from '../types.ts';
import { byId as $, h, append, fill, svg, storage, announce } from '../app/dom.ts';
import type { Child } from '../app/dom.ts';
import { ICON } from '../app/icons.ts';

type Host = typeof import('../chart/model-host.ts');
const loadHost = (): Promise<Host> => import('../chart/model-host.ts');

const params = new URLSearchParams(location.search);
const MAX_TURNS = 20;              // the environment's agent max_turns
const MAX_TOKENS_PER_TURN = 2048;
const APPROX_BYTES = MODEL_FILE.bytes;

const fmtBytes = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(0) + ' MB');
const fmtSize = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB');
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** chart.html, keeping the ?model= override. */
function chartHref(extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  const model = params.get('model');
  if (model) q.set('model', model);
  const s = q.toString();
  return 'chart.html' + (s ? '?' + s : '');
}

// ======================================================================================
// Landing
// ======================================================================================

type Theme = 'auto' | 'light' | 'dark';
const THEMES: Theme[] = ['auto', 'light', 'dark'];
const THEME_TEXT: Record<Theme, string> = { auto: 'Theme: match the system', light: 'Theme: light', dark: 'Theme: dark' };
function themeToggle(button: HTMLElement): void {
  let theme: Theme = ((): Theme => { const t = storage.get<string>('theme', 'auto'); return t === 'light' || t === 'dark' ? t : 'auto'; })();
  const set = (t: Theme) => {
    theme = t;
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    storage.set('theme', t);
    fill(button, svg(t === 'auto' ? ICON.monitor : t === 'light' ? ICON.sun : ICON.moon));
    button.title = THEME_TEXT[t] + ' (click to change)';
    button.setAttribute('aria-label', THEME_TEXT[t]);
  };
  button.addEventListener('click', () => set(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'auto'));
  set(theme);
}

function icons(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) {
    const markup = (ICON as Record<string, string>)[el.dataset.icon ?? ''];
    if (markup) el.replaceChildren(svg(markup));
  }
}

const cta = () => $('cta');
const note = (text: string, cls = '') => { const n = $('cta-note'); n.textContent = text; n.className = 'lp-note' + (cls ? ' ' + cls : ''); };

/** The landing's state, as far as the call to action goes. */
let size: number | null = null;
let stored = 0;

async function landing(): Promise<void> {
  themeToggle($('theme'));
  icons();
  // (the "Browse the charts without the model" link was removed from the landing page)
  let host: Host;
  try { host = await loadHost(); } catch (error) {
    fill(cta(), failureBlock('Could not load the WebGPU runtime: ' + errorText(error), () => location.reload()));
    note('');
    return;
  }
  renderDetails(host);
  await refresh(host);
}

/** Decide the one primary action from what this browser has. */
async function refresh(host: Host): Promise<void> {
  const [found, remote] = await Promise.all([host.probe(), host.remoteBytes()]);
  size = (remote.ok ? remote.bytes : null) ?? host.expectedBytes;
  stored = found.stored;
  renderDetails(host);
  if (found.state === 'unsupported') {
    fill(cta(), h('div', { class: 'lp-alert' }, svg(ICON.alert), h('div', null,
      h('strong', null, 'This browser can’t run the model.'),
      h('span', null, ' It needs WebGPU: a recent Chrome or Edge on a laptop or desktop. You can still browse the charts.'))));
    note('');
    return;
  }
  const complete = stored > 0 && (!size || stored >= size * 0.98);
  if (complete || (stored > 0 && !remote.ok) || host.overridden && stored > 0) {
    fill(cta(), h('a', { class: 'btn lg primary lp-main-btn', href: chartHref() }, 'Open the Chart assistant', svg(ICON.arrowRight)));
    note(`The model is stored in this browser (${fmtBytes(stored)}), so it opens in a few seconds.`);
    return;
  }
  if (!remote.ok && !host.overridden) {
    fill(cta(), failureBlock(`Can’t reach the model weights (${remote.status}). Try again later.`, () => void refresh(host)));
    note('');
    return;
  }
  const left = size && stored ? size - stored : null;
  const label: Child[] = left
    ? ['Finish the download', h('span', { class: 'lp-wide' }, ' and start'), h('span', { class: 'nowrap' }, ` · ${fmtSize(left)} left`)]
    : ['Download ', h('span', { class: 'lp-wide' }, 'the model '), 'and start', h('span', { class: 'nowrap' }, ` · ${fmtSize(size ?? APPROX_BYTES)}`)];
  fill(cta(), h('button', { type: 'button', class: 'btn lg primary lp-main-btn', onclick: () => void start(host) }, svg(ICON.download), h('span', null, label)));
  note('Downloads once and stays in this browser. Needs WebGPU (a recent Chrome or Edge).');
}

/** Download (and check on the GPU), wait for the browser to finish storing it, then open the app. */
async function start(host: Host): Promise<void> {
  const title = h('span', { class: 'lp-progress-title' }, 'Starting…');
  const percent = h('span', { class: 'lp-progress-pct' });
  const bar = h('span');
  const track = h('div', { class: 'progress indeterminate', role: 'progressbar', 'aria-label': 'Download progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
  const meta = h('span', { class: 'lp-progress-meta' });
  fill(cta(), h('div', { class: 'lp-progress', 'aria-live': 'off' },
    h('div', { class: 'lp-progress-head' }, title, percent), track,
    h('div', { class: 'lp-progress-foot' }, meta, h('span', { class: 'lp-progress-hint' }, 'Then the Chart assistant opens'))));
  note('Keep this tab open. It downloads once; next time it opens in seconds.');
  announce('Downloading the model.');
  let lastTotal: number | null = null;
  let phase = '';
  const show = (s: ModelStatus) => {
    if (s.state !== 'loading') return;
    const p = s.total ? Math.min(100, (100 * s.loaded) / s.total) : null;
    track.classList.toggle('indeterminate', p === null);
    if (p !== null) { bar.style.width = `${p.toFixed(1)}%`; track.setAttribute('aria-valuenow', p.toFixed(0)); }
    percent.textContent = p === null ? '' : `${p.toFixed(0)}%`;
    if (s.phase === 'download') {
      const from = host.loadInfo().from;
      title.textContent = from === 'cache' ? 'Loading from this browser' : 'Downloading the model';
      meta.textContent = s.total ? `${fmtBytes(s.loaded)} of ${fmtBytes(s.total)}` : '';
      lastTotal = s.total ?? lastTotal;
    } else if (s.phase === 'gpu') {
      title.textContent = 'Preparing on the GPU';
      meta.textContent = 'Checking that it runs here';
    } else {
      title.textContent = 'Starting…';
    }
    if (s.phase !== phase) { phase = s.phase; if (phase === 'gpu') announce('Preparing the model on the GPU.'); }
  };
  const off = host.subscribe(show);
  try {
    await host.startModel({ download: true });
    off();
    title.textContent = 'Opening the Chart assistant…';
    percent.textContent = '100%';
    track.classList.remove('indeterminate');
    bar.style.width = '100%';
    meta.textContent = 'Saving to this browser';
    announce('The model is ready. Opening the Chart assistant.');
    // The runtime finishes writing its cache just after loading; leave once it has (or after a few seconds).
    const want = (lastTotal ?? size ?? 0) * 0.98;
    for (let i = 0; i < 30 && (await host.storedNow()) < want; i++) await new Promise((r) => setTimeout(r, 200));
    location.assign(chartHref());
  } catch (error) {
    off();
    fill(cta(), failureBlock('The model didn’t load: ' + errorText(error), () => void start(host)));
    note('Nothing was sent anywhere. If it keeps failing, check that this browser supports WebGPU (Chrome or Edge 113+, Safari 26).');
  }
}

function failureBlock(text: string, retry: () => void): HTMLElement {
  return h('div', { class: 'lp-failure' },
    h('div', { class: 'lp-alert err', role: 'alert' }, svg(ICON.alert), h('span', null, text)),
    h('button', { type: 'button', class: 'btn lg primary lp-main-btn', onclick: retry }, svg(ICON.reset), 'Try again'));
}

/** Model details: facts, source, a local GGUF, removing the weights, this device. */
let confirmingRemove = false;
let deviceRows: HTMLElement[] | null = null;
function renderDetails(host: Host): void {
  if (!document.getElementById('details-body')) return; // the Model details dropdown was removed from the landing page
  const src = host.source;
  const fact = (k: string, v: Child) => [h('dt', null, k), h('dd', null, v)];
  const facts = h('dl', { class: 'lp-facts' },
    fact('Model', MODEL_FACTS.name),
    fact('Base', MODEL_FACTS.base),
    fact('Training', MODEL_FACTS.training),
    fact('Quantization', MODEL_FACTS.quantization),
    fact('Result', MODEL_FACTS.result),
    fact('Source', src.page ? h('a', { href: src.page, target: '_blank', rel: 'noopener' }, src.label) : src.label),
    fact('Size', size ? fmtBytes(size) : fmtBytes(APPROX_BYTES)),
    host.overridden ? null : fact('SHA-256', h('code', { title: MODEL_FILE.sha256 }, `${MODEL_FILE.sha256.slice(0, 12)}…`)),
    fact('In this browser', stored ? `Stored (${fmtBytes(stored)})` : 'Not downloaded'));
  const local = h('a', { class: 'btn sm', href: chartHref({ local: '1' }), title: 'Open the Chart assistant and choose a .gguf file on this computer' }, svg(ICON.upload), 'Use a local GGUF…');
  const remove = !stored ? null : confirmingRemove
    ? h('div', { class: 'lp-confirm' },
      h('span', null, `Remove ${fmtBytes(stored)} from this browser?`),
      h('span', { class: 'row' },
        h('button', { type: 'button', class: 'btn sm', onclick: () => { confirmingRemove = false; renderDetails(host); } }, 'Cancel'),
        h('button', { type: 'button', class: 'btn sm lp-danger', onclick: async () => {
          confirmingRemove = false;
          const freed = await host.removeModel();
          announce(`Removed from this browser${freed ? `; ${fmtBytes(freed)} freed` : ''}.`);
          await refresh(host);
        } }, 'Remove')))
    : h('button', { type: 'button', class: 'btn sm ghost lp-remove', onclick: () => { confirmingRemove = true; renderDetails(host); } }, svg(ICON.trash), 'Remove from this browser');
  const deviceList = h('ul', { class: 'lp-checks' }, deviceRows ?? h('li', { class: 'muted' }, 'Checking…'));
  const device = h('details', { class: 'disclosure lp-device' }, h('summary', null, 'This device'), deviceList);
  device.addEventListener('toggle', () => {
    if (!device.open || deviceRows) return;
    void host.deviceChecks().then((items) => {
      deviceRows = items.map((c) => h('li', { class: c.ok === true ? 'ok' : c.ok === false ? 'bad' : '' },
        h('span', { class: 'lp-check-mark', 'aria-hidden': 'true' }, svg(c.ok === true ? ICON.check : c.ok === false ? ICON.x : ICON.info)),
        h('span', null, h('strong', null, c.name), h('span', { class: 'muted' }, c.detail))));
      fill(deviceList, deviceRows);
    });
  });
  const wasOpen = document.querySelector<HTMLDetailsElement>('.lp-device')?.open ?? false;
  device.open = wasOpen && !!deviceRows;
  fill($('details-body'), facts, h('div', { class: 'lp-detail-actions' }, local, remove), device);
}

// ======================================================================================
// ?simple=1: the self-test page (kept for scripts/bench_chrome.ts)
// ======================================================================================

interface Contract { system_prompt: string; tools: Tool[] }
interface Question { id: string; family: string; prompt: string; read_only: boolean; gold: { answer: unknown; evidence: string[] } }
interface Chart { resources: FhirResource[]; questions?: Question[]; patient_id?: string }
interface Turn { promptTokens: number; cached: number; newPrompt: number; completion: number; ttftMs?: number; decodeMs?: number; finish: string }
type Final = { ok: true; answer: unknown; evidence: unknown; raw?: string } | { ok: false; error: string; raw?: string };
interface RunRecord {
  question: string; turns: Turn[]; start: number; ms: number; final: Final; calls: number;
  answerMatch?: boolean; evidenceMatch?: boolean;
}

const state: {
  contract: Contract | null; chart: Chart | null; model: Model | null; size: number | null;
  sourceError: number | string | null; busy: boolean; ready: boolean;
  loadSeconds?: number; loadedFrom?: string;
} = { contract: null, chart: null, model: null, size: null, sourceError: null, busy: false, ready: false };
const metrics: { runs: RunRecord[] } = { runs: [] };

declare global {
  interface Window {
    demoState: typeof state;
    demoMetrics: typeof metrics;
    runBench: () => Promise<unknown>;
  }
}
window.demoState = state;
window.demoMetrics = metrics;

const button = (id: string) => $<HTMLButtonElement>(id);

function chip(text: string, cls = ''): void { $('model-chip').textContent = text; $('model-chip').className = 'badge ' + cls; }
function setState(text: string, cls = ''): void { $('model-state').textContent = text; $('model-state').className = 'simple-state ' + cls; }
function progress(loaded: number, total: number | null | undefined, label: string): void {
  $('progress-wrap').hidden = false;
  const f = total ? Math.min(1, loaded / total) : 0;
  $('progress-bar').style.width = (100 * f).toFixed(1) + '%';
  $('progress-text').textContent = total ? `${label} · ${fmtBytes(loaded)} of ${fmtBytes(total)} · ${(100 * f).toFixed(0)}%` : label;
}

async function refreshModelCard(host: Host): Promise<void> {
  const src = host.source;
  const link = $<HTMLAnchorElement>('model-source');
  $('model-name').textContent = MODEL_FACTS.name;
  link.textContent = src.label;
  if (src.page) link.href = src.page; else link.removeAttribute('href');
  const storedBytes = await host.storedNow();
  if (state.size === null) {
    const r = await host.remoteBytes();
    state.size = r.ok ? r.bytes : null;
    state.sourceError = r.ok ? null : r.status;
  }
  $('model-size').textContent = state.size ? fmtBytes(state.size) : '';
  const complete = storedBytes > 0 && (!state.size || storedBytes >= state.size * 0.98);
  $('offload').hidden = storedBytes === 0;
  if (state.ready) return;
  const load = button('load');
  if (complete) {
    setState(`Stored in this browser (${fmtBytes(storedBytes)}). Loading takes a few seconds.`, 'ok');
    load.textContent = 'Load';
    load.disabled = !navigator.gpu;
  } else if (state.sourceError) {
    setState(`Can't reach the weights (${state.sourceError}). If the Hugging Face repo isn't published yet, use a local GGUF.`, 'bad');
    load.textContent = 'Download and load';
    load.disabled = true;
  } else {
    setState(storedBytes > 0
      ? `Partly stored (${fmtBytes(storedBytes)}${state.size ? ` of ${fmtBytes(state.size)}` : ''}); the download resumes.`
      : `Not downloaded yet${state.size ? ` (${fmtBytes(state.size)})` : ''}. It is stored in this browser for next time.`);
    load.textContent = 'Download and load';
    load.disabled = !navigator.gpu;
  }
}

async function loadModel(host: Host, file: File | null = null): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  for (const id of ['load', 'offload']) button(id).disabled = true;
  chip('Loading…', 'accent');
  setState(file ? `Loading ${file.name} from this computer…` : 'Loading…');
  const t0 = performance.now();
  const off = host.subscribe((s) => {
    if (s.state !== 'loading') return;
    if (s.phase === 'download') progress(s.loaded, s.total, file ? 'Reading' : 'Downloading');
    else if (s.phase === 'gpu') progress(s.loaded, s.total, 'Preparing on the GPU');
    else $('progress-text').textContent = s.message || '';
  });
  try {
    state.model = null;
    state.ready = false;
    state.model = await host.startModel(file ? { file } : { download: true });
    if (!state.model) throw new Error('This browser has no WebGPU');
    state.ready = true;
    state.loadSeconds = (performance.now() - t0) / 1000;
    state.loadedFrom = file ? file.name : host.source.label;
    $('progress-wrap').hidden = true;
    setState(`Ready: ${state.loadedFrom}, loaded in ${state.loadSeconds.toFixed(1)} s.`, 'ok');
    chip('Model ready', 'ok');
    button('load').textContent = 'Loaded';
    button('load').disabled = true;
  } catch (error) {
    $('progress-wrap').hidden = true;
    setState('Could not load the model: ' + errorText(error), 'bad');
    chip('Model not loaded');
    state.ready = false;
  } finally {
    off();
    state.busy = false;
    button('offload').disabled = false;
    updateAsk();
    // The runtime finishes writing its cache just after loading; refresh once it has.
    if (!file) { void refreshModelCard(host); setTimeout(() => void refreshModelCard(host), 2500); }
  }
}

async function offloadModel(host: Host): Promise<void> {
  button('offload').disabled = true;
  state.model = null;
  state.ready = false;
  const freed = await host.removeModel();
  chip('Model not loaded');
  button('load').disabled = false;
  await refreshModelCard(host);
  setState(`Removed from this browser${freed ? `; ${fmtBytes(freed)} freed` : ''}.`);
  updateAsk();
}

async function deviceChecks(host: Host): Promise<void> {
  const items = await host.deviceChecks();
  $('checks').replaceChildren(...items.map((c) =>
    h('li', { class: c.ok === true ? 'ok' : c.ok === false ? 'bad' : '' }, h('strong', null, c.name), ' ', h('span', { class: 'muted' }, c.detail))));
  if (items.some((c) => c.name === 'WebGPU' && c.ok === false)) { chip('WebGPU unavailable', 'err'); setState('This browser cannot run the model; see "This device".', 'bad'); }
}

interface HumanName { given?: string[]; family?: string }
interface Identifier { system?: string; value?: string }

function loadChart(data: Chart): void {
  state.chart = data;
  const patient = data.resources.find((r) => r.resourceType === 'Patient' && (!data.patient_id || r.id === data.patient_id))
    || data.resources.find((r) => r.resourceType === 'Patient');
  const name = (patient?.name as HumanName[] | undefined)?.[0];
  const ids = (patient?.identifier as Identifier[] | undefined) ?? [];
  const mrn = ids.find((i) => /mrn/i.test(i.system || ''))?.value || ids[0]?.value;
  const field = (k: string, v: unknown): HTMLDivElement[] => (v ? [h('div', null, h('dt', null, k), h('dd', null, String(v)))] : []);
  $('patient').replaceChildren(
    h('div', { class: 'name' }, name ? [(name.given || []).join(' '), name.family].filter(Boolean).join(' ') : 'Unnamed chart'),
    ...field('MRN', mrn), ...field('Born', patient?.birthDate), ...field('Sex', patient?.gender),
    ...field('Reference', patient ? `Patient/${patient.id}` : null),
  );
  const counts: Record<string, number> = {};
  for (const r of data.resources) counts[r.resourceType] = (counts[r.resourceType] || 0) + 1;
  $('records-summary').textContent = `${data.resources.length} records`;
  $('records').replaceChildren(...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => h('span', { class: 'badge' }, `${k} ${n}`)));
  const select = $<HTMLSelectElement>('examples');
  const qs = (data.questions || []).filter((q) => q.read_only);
  select.hidden = !qs.length;
  select.replaceChildren(h('option', { value: '' }, 'Example questions…'),
    ...qs.map((q) => h('option', { value: q.id }, (q.prompt.split('\n')[0] ?? '').replace(/^For known patient Patient\/\w+, /, '').slice(0, 120))));
  select.onchange = () => { const q = qs.find((x) => x.id === select.value); if (q) $<HTMLTextAreaElement>('question').value = q.prompt; };
}

/** A Bundle, NDJSON, a JSON array of resources, or this demo's own chart file. */
async function loadFhirFile(file: File): Promise<void> {
  const text = await file.text();
  const t = text.trimStart();
  let resources: FhirResource[];
  if (t.startsWith('{')) {
    const obj = pyParse(text) as Record<string, unknown>;
    if (Array.isArray(obj.resources)) { loadChart(obj as unknown as Chart); return; }
    resources = obj.resourceType === 'Bundle'
      ? ((obj.entry as { resource?: FhirResource }[] | undefined) || []).map((e) => e.resource).filter((r): r is FhirResource => !!r)
      : [obj as FhirResource];
  } else if (t.startsWith('[')) resources = pyParse(text) as FhirResource[];
  else resources = text.split('\n').filter((l) => l.trim()).map((l) => pyParse(l) as FhirResource);
  for (const r of resources) { r.meta = r.meta || {}; r.meta.versionId = r.meta.versionId || '1'; }
  loadChart({ resources, questions: [] });
}

function openRecord(reference: string): void {
  const r = state.chart?.resources.find((x) => ref(x) === reference);
  $('drawer-title').textContent = reference;
  $('drawer-body').textContent = r ? JSON.stringify(r, null, 2) : 'This record is not in the loaded chart.';
  $('drawer').hidden = false;
}

function updateAsk(): void {
  button('ask').disabled = !state.ready || state.busy;
  $('ask-note').textContent = state.ready ? '' : 'Load the model to ask.';
}

/** Scalars as text, lists of scalars joined, lists of objects as a table, objects as key/value rows. */
function renderValue(v: unknown): Child {
  if (v === null || v === undefined) return h('span', { class: 'muted' }, '—');
  if (Array.isArray(v)) {
    if (!v.length) return h('span', { class: 'muted' }, 'none');
    if (v.every((x) => !isRecord(x) || x.valueOf() !== x)) return v.map(String).join(', ');
    const keys = [...new Set(v.flatMap((x) => (isRecord(x) ? Object.keys(x) : [])))];
    return h('table', null, h('tr', null, ...keys.map((k) => h('th', null, k))),
      ...v.map((row) => h('tr', null, ...keys.map((k) => h('td', null, renderValue(isRecord(row) ? row[k] : undefined))))));
  }
  if (isRecord(v) && v.valueOf() === v) {
    return h('table', null, ...Object.entries(v).map(([k, x]) => h('tr', null, h('th', null, k), h('td', null, renderValue(x)))));
  }
  return String(v);
}

/** Key order free; 13 equals 13.0 (gold numbers may be PyFloat). */
function deepEqual(a: unknown, b: unknown): boolean {
  const num = (x: unknown) => (x !== null && x !== undefined && typeof (x as { valueOf(): unknown }).valueOf() === 'number');
  if (num(a) && num(b)) return (a as { valueOf(): number }).valueOf() === (b as { valueOf(): number }).valueOf();
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return deepEqual(ka, kb) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return a === b;
}

function summarizeResult(body: unknown): string {
  if (!isRecord(body)) return '';
  if (body.resourceType === 'Bundle') return `${body.total ?? (Array.isArray(body.entry) ? body.entry.length : 0)} found`;
  return body.id ? `${body.resourceType}/${body.id}` : '';
}

async function ask(question: string): Promise<RunRecord | null> {
  const { model, contract, chart } = state;
  if (!state.ready || state.busy || !question || !model || !contract || !chart) return null;
  state.busy = true;
  updateAsk();
  const gold = chart.questions?.find((q) => q.prompt === question)?.gold;
  const store = new FhirStore(chart.resources);
  const options: GenerateOptions = {
    tools: contract.tools,
    enable_thinking: $<HTMLInputElement>('thinking').checked,
    max_new_tokens: MAX_TOKENS_PER_TURN,
    temperature: Number($<HTMLInputElement>('temp').value) || 0,
    top_k: 50,
    seed: 42,
  };
  const messages: ChatMessage[] = [{ role: 'system', content: contract.system_prompt }, { role: 'user', content: question }];
  const steps = h('ol');
  const live = h('div', { class: 'live' });
  const run = h('div', { class: 'run' }, h('div', { class: 'q' }, question), live);
  $('runs').prepend(run);
  const turns: Turn[] = [];
  const start = performance.now();
  const session = model.create_session();
  let final: Final | null = null;
  chip('Thinking…', 'accent');
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      live.textContent = `Step ${turn + 1}…`;
      let thought = '';
      const gen = session.generate(messages, options);
      for await (const ev of gen) {
        if (ev.type === 'reasoning' || ev.type === 'text') { thought += ev.text; live.textContent = thought.slice(-600); }
      }
      const r = await gen.result;
      const u = r.usage, tm = r.timings;
      turns.push({ promptTokens: u.prompt_tokens, cached: u.cached_tokens || 0, newPrompt: (u.prompt_tokens || 0) - (u.cached_tokens || 0),
        completion: u.completion_tokens, ttftMs: tm?.ttft_ms, decodeMs: tm?.decode_ms, finish: r.finish_reason });
      messages.push(r.message);
      const calls = r.message.tool_calls || [];
      const reasoning = (r.message.reasoning_content || '').trim();
      if (calls.length) {
        for (const c of calls) {
          let out: string;
          if (c.function.name !== 'fhir_request') out = pyDumps({ error: `Unknown tool: ${c.function.name}` });
          else if (c.errors?.length) out = pyDumps({ error: c.errors.join('; ') });
          else out = store.fhirRequest(c.function.arguments);
          const result = JSON.parse(out) as { status?: number; body?: unknown };
          const status = result.status;
          const a = c.function.arguments || {};
          append(steps, h('li', null,
            reasoning ? h('details', null, h('summary', { class: 'muted' }, 'Reasoning'), h('div', { class: 'thought' }, reasoning)) : null,
            h('span', { class: 'req' }, `${String(a.method ?? '?')} ${String(a.path ?? '')}`), ' ',
            h('span', { class: status === undefined || status >= 400 ? 'status-err' : 'status-ok' }, status === undefined ? 'error' : String(status)),
            ...(status !== undefined && status < 300 ? [' ', h('span', { class: 'muted' }, summarizeResult(result.body))] : [])));
          messages.push({ role: 'tool', tool_call_id: c.id, content: out });
        }
        continue;
      }
      if (reasoning) append(steps, h('li', null, h('details', null, h('summary', { class: 'muted' }, 'Reasoning before the answer'), h('div', { class: 'thought' }, reasoning))));
      if (r.finish_reason === 'length') throw new Error('The model hit its per-step token limit.');
      const raw = (r.message.content || '').trim();
      final = { ...(parseFinal(raw) as Final), raw };
      break;
    }
    if (!final) final = { ok: false, error: `No answer within ${MAX_TURNS} steps.` };
  } catch (error) {
    final = { ok: false, error: errorText(error) };
  } finally {
    await session.dispose();
    state.busy = false;
    chip('Model ready', 'ok');
    updateAsk();
  }
  const record: RunRecord = { question, turns, start, ms: performance.now() - start, final, calls: store.events.length };
  if (gold && final.ok) {
    record.answerMatch = deepEqual(final.answer, gold.answer);
    record.evidenceMatch = deepEqual([...(Array.isArray(final.evidence) ? final.evidence : [])].sort(), [...gold.evidence].sort());
  }
  metrics.runs.push(record);
  live.remove();
  renderRun(run, final, store, gold, record, steps);
  return record;
}

function renderRun(run: HTMLElement, final: Final, store: FhirStore, gold: Question['gold'] | undefined, record: RunRecord, steps: HTMLElement): void {
  const sum = (k: 'completion' | 'decodeMs') => record.turns.reduce((a, t) => a + (t[k] || 0), 0);
  const tps = sum('completion') / (sum('decodeMs') / 1000);
  const meta = h('div', { class: 'meta' },
    `${(record.ms / 1000).toFixed(1)} s · ${record.calls} FHIR request${record.calls === 1 ? '' : 's'} · ${record.turns.length} model steps · ${tps.toFixed(0)} tokens/s`);
  if (!final.ok) {
    append(run, h('div', { class: 'verdict bad' }, 'No valid answer: ' + final.error),
      final.raw ? h('pre', { class: 'answer mono' }, final.raw) : null, meta,
      h('details', { class: 'disclosure steps' }, h('summary', null, 'Steps'), steps));
    return;
  }
  const evidence = Array.isArray(final.evidence) ? final.evidence.filter((r): r is string => typeof r === 'string') : [];
  const missing = evidence.filter((r) => !store.seen.has(r));
  const verdict = !evidence.length
    ? h('div', { class: 'verdict warn' }, 'No records cited.')
    : missing.length
      ? h('div', { class: 'verdict bad' }, `${missing.length} of ${evidence.length} cited records were never retrieved.`)
      : h('div', { class: 'verdict ok' }, `Every cited record (${evidence.length}) was retrieved while answering.`);
  append(run,
    verdict,
    h('div', { class: 'answer' }, renderValue(final.answer)),
    h('div', { class: 'evidence' }, ...evidence.map((r) => h('button', { type: 'button', class: 'ref mono ' + (store.seen.has(r) ? 'ok' : 'bad'), onclick: () => openRecord(r) }, r))),
    gold ? h('div', { class: 'meta' }, record.answerMatch && record.evidenceMatch
      ? 'Matches the benchmark answer and evidence.'
      : `Benchmark: answer ${record.answerMatch ? 'matches' : 'differs'}, evidence ${record.evidenceMatch ? 'matches' : 'differs'}.`) : null,
    meta,
    h('details', { class: 'disclosure steps' }, h('summary', null, 'Steps'), steps),
  );
}

// Every read-only example in turn (used by scripts/bench_chrome.ts).
window.runBench = async () => {
  const results = [];
  for (const q of (state.chart?.questions ?? []).filter((x) => x.read_only)) {
    const r = await ask(q.prompt);
    if (!r) continue;
    const sum = (k: 'completion' | 'decodeMs' | 'newPrompt' | 'ttftMs') => r.turns.reduce((a, t) => a + (t[k] || 0), 0);
    const last = r.turns.at(-1);
    results.push({
      family: q.family, ok: r.final.ok, answerMatch: !!r.answerMatch, evidenceMatch: !!r.evidenceMatch,
      ms: r.ms, turns: r.turns.length, calls: r.calls, completionTokens: sum('completion'), decodeMs: sum('decodeMs'),
      newPromptTokens: sum('newPrompt'), ttftMs: sum('ttftMs'),
      contextTokens: last ? last.promptTokens + last.completion : 0,
      error: r.final.ok ? null : r.final.error,
    });
  }
  return { load: { seconds: state.loadSeconds, from: state.loadedFrom }, results };
};

async function simple(): Promise<void> {
  document.body.className = 'simple-page';
  $('landing').remove();
  const template = $<HTMLTemplateElement>('simple-mode');
  document.body.append(template.content.cloneNode(true));
  const host = await loadHost();
  const [contract, chart] = await Promise.all([
    fetchDataJson<Contract>('data/contract.json'),
    fetchDataText('data/patient.json').then((r) => pyParse(r.text) as unknown as Chart),
  ]);
  state.contract = contract;
  loadChart(chart);
  const fileInput = (id: string, use: (file: File) => void) => {
    const input = $<HTMLInputElement>(id);
    input.onchange = () => { const f = input.files?.[0]; input.value = ''; if (f) use(f); };
  };
  button('load').onclick = () => void loadModel(host);
  button('offload').onclick = () => void offloadModel(host);
  fileInput('local-gguf', (f) => void loadModel(host, f));
  fileInput('fhir-file', (f) => void loadFhirFile(f));
  button('drawer-close').onclick = () => { $('drawer').hidden = true; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('drawer').hidden = true; });
  const form = $<HTMLFormElement>('ask-form');
  const textarea = $<HTMLTextAreaElement>('question');
  form.onsubmit = (e) => { e.preventDefault(); void ask(textarea.value.trim()); };
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!button('ask').disabled) form.requestSubmit(); }
  });
  await Promise.all([deviceChecks(host), refreshModelCard(host)]);
  if (params.has('autoload') && navigator.gpu) await loadModel(host);
}

if (params.has('simple')) {
  simple().catch((e: unknown) => {
    if (document.getElementById('model-state')) setState('Error: ' + errorText(e), 'bad');
    console.error(e);
  });
} else {
  landing().catch((e: unknown) => console.error(e));
}
