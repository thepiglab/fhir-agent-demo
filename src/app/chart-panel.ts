// The chart side panel (aside#chart-panel): Summary, Records (the full chart), Record (one record
// and its links) and, in developer mode, Console (FHIR requests against the sandbox copy).
// The header holds the tabs, the sandbox change count with Reset, and Close.
//
//   chart-summary.ts  patient card and summary sections
//   chart-records.ts  the full chart: visits, notes and reports, records by type, filter
//   chart-record.ts   one record, the trail of records opened, the link graph
//   chart-console.ts  the FHIR console
import './chart-panel.css';
import { h, fill, byId, svg, announce, failure, plural } from './dom.ts';
import { ICON } from './icons.ts';
import { app, api, emit, on, setPanel } from './state.ts';
import type { FullChart, Summary } from './chart-types.ts';
import { patientCard, resetSummaryState, summarySections } from './chart-summary.ts';
import { renderRecords, resetRecordsState } from './chart-records.ts';
import * as record from './chart-record.ts';
import * as cons from './chart-console.ts';

type Tab = 'summary' | 'records' | 'record' | 'console';
const TABS: Tab[] = ['summary', 'records', 'record', 'console'];
const TAB_LABEL: Record<Tab, string> = { summary: 'Summary', records: 'Records', record: 'Record', console: 'Console' };

const st = {
  tab: 'summary' as Tab,
  summary: null as Summary | null,
  summarySeq: 0,
  chart: null as FullChart | null,
  chartStale: true,
  chartSeq: 0,
  /** The sandbox change count the panel's views were loaded with. */
  known: 0,
  confirming: false,
  resetting: false,
};

// ---------- skeleton ----------
const tabButtons = new Map<Tab, HTMLButtonElement>();
const views = new Map<Tab, HTMLElement>();
const tablist = h('div', { class: 'tabs cp-tabs', role: 'tablist', 'aria-label': 'Chart views' });
const tools = h('div', { class: 'cp-tools' });
const confirmBar = h('div', { class: 'cp-confirm', role: 'status', hidden: true });
const summaryView = h('div', { class: 'cp-pad' });
const recordsView = h('div', { class: 'cp-pad' });

for (const tab of TABS) {
  const button = h('button', { type: 'button', role: 'tab', id: `cp-tab-${tab}`, 'aria-controls': `cp-view-${tab}`, 'aria-selected': 'false', tabindex: -1,
    class: tab === 'console' ? 'dev-only' : '', onclick: () => show(tab) }, TAB_LABEL[tab]);
  tabButtons.set(tab, button);
  tablist.append(button);
  const inner = tab === 'summary' ? summaryView : tab === 'records' ? recordsView : tab === 'record' ? record.recordView : h('div', { class: 'cp-pad' }, cons.consoleView);
  views.set(tab, h('div', { class: 'cp-view scroll', role: 'tabpanel', id: `cp-view-${tab}`, 'aria-labelledby': `cp-tab-${tab}`, hidden: true, tabindex: -1 }, inner));
}

const visibleTabs = (): Tab[] => TABS.filter((t) => (t !== 'console' || app.dev) && (t !== 'record' || record.hasTrail()));

function renderTabs(): void {
  const visible = visibleTabs();
  for (const [tab, button] of tabButtons) {
    button.hidden = !visible.includes(tab);
    const selected = tab === st.tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (tab === 'record') {
      button.textContent = record.currentLabel();
      button.title = record.currentRef() ?? '';
    }
  }
}

/** The close button, and under the tabs a slim sandbox bar while the chart copy has changes (with Reset and its confirm step). */
function renderTools(): void {
  const n = app.sandboxChanges;
  if (!tools.firstChild) {
    fill(tools, h('button', { type: 'button', class: 'btn ghost icon sm cp-close', title: 'Close the chart', 'aria-label': 'Close the chart', onclick: () => setPanel(false) }, svg(ICON.close)));
  }
  if (n <= 0) st.confirming = false;
  confirmBar.hidden = n <= 0;
  confirmBar.classList.toggle('confirming', st.confirming);
  if (n <= 0) { confirmBar.replaceChildren(); return; }
  const why = "Writes from the assistant or the console change only this browser's private copy of the chart. The source data never changes.";
  if (!st.confirming) {
    fill(confirmBar,
      h('span', { class: 'cp-confirm-text', title: why }, h('span', { class: 'cp-changes' }, plural(n, 'change')), ' to this private copy of the chart'),
      h('button', { type: 'button', class: 'btn ghost sm cp-reset', title: 'Discard the changes to this chart copy',
        onclick: () => { st.confirming = true; renderTools(); confirmBar.querySelector<HTMLButtonElement>('.cp-danger')?.focus(); } },
      svg(ICON.reset), 'Reset'));
    return;
  }
  fill(confirmBar,
    h('span', { class: 'cp-confirm-text', role: 'alert' }, `Discard ${plural(n, 'change')}? The chart goes back to its original records.`),
    h('span', { class: 'cp-confirm-actions' },
      h('button', { type: 'button', class: 'btn sm cp-danger', disabled: st.resetting, onclick: () => void reset() }, st.resetting ? 'Resetting…' : 'Reset'),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { st.confirming = false; renderTools(); } }, 'Cancel')));
}

function show(tab: Tab, { focus = false } = {}): void {
  if (!visibleTabs().includes(tab)) tab = 'summary';
  st.tab = tab;
  for (const [t, view] of views) view.hidden = t !== tab;
  renderTabs();
  if (focus) tabButtons.get(tab)?.focus();
  refresh();
}

/** Load what the visible tab needs (only while the panel is open). */
function refresh(): void {
  if (!app.panelOpen || !app.patient) return;
  if (st.tab === 'summary' && !st.summary) void loadSummary();
  if (st.tab === 'records' && (!st.chart || st.chartStale)) void loadChart();
  if (st.tab === 'record' && record.recordStale()) record.reloadRecord();
  if (st.tab === 'console') cons.consoleOnShow();
}

// ---------- summary ----------
const skeletonCard = (): HTMLElement => h('div', { class: 'cp-skel-wrap', 'aria-busy': 'true', 'aria-label': 'Loading the summary' },
  h('div', { class: 'cp-pt' }, h('div', { class: 'cp-skel w50 tall' }), h('div', { class: 'cp-skel w70' }), h('div', { class: 'cp-skel-gap' }),
    h('div', { class: 'cp-skel w40' }), h('div', { class: 'cp-skel w60' }), h('div', { class: 'cp-skel w30' })),
  ...[1, 2, 3].map(() => h('div', { class: 'cp-skel-sec' }, h('div', { class: 'cp-skel w20' }), h('div', { class: 'cp-skel w90' }), h('div', { class: 'cp-skel w80' }), h('div', { class: 'cp-skel w60' }))));

async function loadSummary(): Promise<void> {
  const patient = app.patient;
  if (!patient) return;
  const seq = ++st.summarySeq;
  if (!st.summary) fill(summaryView, skeletonCard());
  summaryView.setAttribute('aria-busy', 'true');
  try {
    const summary = await api<Summary>('/api/summary', { patient: patient.id });
    if (seq !== st.summarySeq) return;
    st.summary = summary;
    st.known = summary.changes;
    if (app.sandboxChanges !== summary.changes) { app.sandboxChanges = summary.changes; renderTools(); }
    renderSummary();
  } catch (error) {
    if (seq !== st.summarySeq) return;
    st.summary = null;
    fill(summaryView, app.patient ? patientCard(app.patient, null, renderSummary) : null,
      failure('Could not load the summary: ' + (error instanceof Error ? error.message : String(error)), () => void loadSummary()));
  } finally {
    if (seq === st.summarySeq) summaryView.removeAttribute('aria-busy');
  }
}
function renderSummary(): void {
  const p = app.patient, s = st.summary;
  if (!p || !s) return;
  const scroller = views.get('summary');
  const scroll = scroller?.scrollTop ?? 0;
  fill(summaryView, patientCard(p, s, renderSummary), h('div', { class: 'cp-sections' }, summarySections(s, renderSummary, () => show('records'))));
  if (scroller) scroller.scrollTop = scroll;
}

// ---------- full chart ----------
async function loadChart(): Promise<void> {
  const patient = app.patient;
  if (!patient) return;
  st.chartStale = false;
  const seq = ++st.chartSeq;
  if (!st.chart) fill(recordsView, h('div', { class: 'cp-skel-wrap', 'aria-label': 'Loading the records' },
    h('div', { class: 'cp-skel w100 tall' }), h('div', { class: 'cp-skel-gap' }), ...[30, 90, 80, 85, 70, 90, 60].map((w) => h('div', { class: `cp-skel w${w}` }))));
  try {
    const chart = await api<FullChart>('/api/chart', { patient: patient.id });
    if (seq !== st.chartSeq) return;
    const scroller = views.get('records');
    const scroll = st.chart ? scroller?.scrollTop ?? 0 : 0;
    st.chart = chart;
    renderRecords(recordsView, chart, { console: toConsole });
    if (scroller) scroller.scrollTop = scroll;
  } catch (error) {
    if (seq !== st.chartSeq) return;
    st.chartStale = true;
    fill(recordsView, failure('Could not load the records: ' + (error instanceof Error ? error.message : String(error)), () => void loadChart()));
  }
}

function toConsole(path: string): void {
  if (!app.dev) return;
  show('console');
  void cons.run({ method: 'GET', path });
}

// ---------- sandbox ----------
async function reset(): Promise<void> {
  const patient = app.patient;
  if (!patient || st.resetting) return;
  st.resetting = true;
  renderTools();
  try {
    await api('/api/reset', { patient: patient.id });
    st.confirming = false;
    emit('sandbox', { patient: patient.id, changes: 0 });
    cons.consoleAfterReset();
    announce('Changes discarded. The chart is back to its original records.');
  } catch (error) {
    announce('Could not discard the changes: ' + (error instanceof Error ? error.message : String(error)));
  } finally {
    st.resetting = false;
    renderTools();
  }
}

function onSandbox({ patient, changes }: { patient: string; changes: number }): void {
  if (patient !== app.patient?.id) return;
  app.sandboxChanges = changes;
  renderTools();
  if (changes === st.known) return;
  st.known = changes;
  // Reload what shows the chart: the visible view now, the others when next shown.
  st.chartStale = true;
  record.markRecordStale();
  void loadSummary();
  refresh();
}

function onPatient(): void {
  st.summarySeq += 1; st.chartSeq += 1;
  st.summary = null; st.chart = null; st.chartStale = true; st.confirming = false; st.known = 0;
  app.sandboxChanges = 0;
  resetSummaryState();
  resetRecordsState();
  record.resetTrail();
  cons.consoleOnPatient();
  fill(recordsView);
  renderTools();
  void loadSummary();
  show(st.tab === 'record' ? 'summary' : st.tab);
}

// ---------- init ----------
export function init(): void {
  const panel = byId('chart-panel');
  const root = h('div', { class: 'cp' },
    h('header', { class: 'cp-header' }, h('div', { class: 'cp-header-row' }, tablist, tools), confirmBar),
    ...views.values());
  fill(panel, root);
  fill(summaryView, h('div', { class: 'empty' }, 'Choose a patient to see the chart.'));

  record.initRecord({
    show: () => { if (st.tab !== 'record') show('record'); else renderTabs(); },
    trail: renderTabs,
    console: toConsole,
  });
  cons.initConsole({ open: (ref) => void record.open(ref), knownChanges: () => st.known });

  // Record links anywhere in the panel open the Record tab; links in a console response browse the console.
  root.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ref]') : null;
    if (!link || link.closest('.cp-graph')) return;
    const ref = link.dataset.ref;
    if (!ref) return;
    event.preventDefault();
    if (link.closest('.cp-response')) void cons.run({ method: 'GET', path: ref });
    else void record.open(ref);
  });
  tablist.addEventListener('keydown', (event) => {
    const tabs = visibleTabs();
    const i = tabs.indexOf(st.tab);
    const next = ({ ArrowRight: tabs[(i + 1) % tabs.length], ArrowLeft: tabs[(i + tabs.length - 1) % tabs.length], Home: tabs[0], End: tabs[tabs.length - 1] } as Record<string, Tab | undefined>)[event.key];
    if (!next) return;
    event.preventDefault();
    show(next, { focus: true });
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (st.confirming) { st.confirming = false; renderTools(); return; }
    if (matchMedia('(max-width: 640px)').matches) setPanel(false);
  });

  on('patient', onPatient);
  on('sandbox', onSandbox);
  on('openRecord', (ref) => {
    if (!app.panelOpen) setPanel(true);
    void record.open(ref);
  });
  on('dev', (devOn) => {
    if (!devOn && st.tab === 'console') show('summary');
    else renderTabs();
    record.rerenderRecord();
  });
  on('panel', (open) => { if (open) refresh(); });

  renderTools();
  show('summary');
  // The host may mount the panel after a patient was chosen (or remount it): catch up.
  if (app.patient) onPatient();
}
