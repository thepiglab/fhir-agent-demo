// The chart panel's Records tab: every record of the chart as a visit timeline, notes and reports
// (filterable by kind), and every record grouped by type, with one text filter over all three.
import { h, fmtNum, fmtDate, dateRange, cap, day, joined, plural, emptyLine, svg } from './dom.ts';
import type { Child } from './dom.ts';
import { ICON } from './icons.ts';
import { typeNoun } from './state.ts';
import { KIND, KINDS, visitClass } from './chart-summary.ts';
import { searchPath } from './chart-console.ts';
import type { ChartGroup, DocItem, FullChart } from './chart-types.ts';

const SCOPES: Record<string, string> = {
  own: "This patient's records",
  referenced: 'Shared records the chart references',
  referencing: 'Shared records that reference the chart',
};

const ui = { docKind: 'all', openGroups: new Set<string>(), closedSections: new Set<string>(), query: '' };
export function resetRecordsState(): void { ui.docKind = 'all'; ui.openGroups.clear(); ui.query = ''; }

export interface RecordsHooks {
  /** Run a GET in the console (developer mode). */
  console(path: string): void;
}

let root: HTMLElement | null = null;
let overview = '';
let countLine: HTMLElement | null = null;

const rowButton = (ref: string, text: string, ...children: Child[]): HTMLElement =>
  h('button', { type: 'button', class: 'cp-rec', 'data-ref': ref, 'data-text': text.toLowerCase(), title: ref }, ...children);

function chartSection(key: string, title: string, count: number, body: Child): HTMLElement {
  const node = h('details', { class: 'disclosure cp-sec', open: !ui.closedSections.has(key) },
    h('summary', null, h('span', { class: 'cp-sec-title' }, title), h('span', { class: 'cp-count', 'data-total': count }, fmtNum(count))),
    h('div', { class: 'cp-sec-body' }, body));
  node.addEventListener('toggle', () => { if (node.open) ui.closedSections.delete(key); else ui.closedSections.add(key); });
  return node;
}

/** Newest first, with year markers and the as-of date the clinical suites treat as today. */
function timeline(chart: FullChart): Child {
  if (!chart.encounters.length) return emptyLine('No visits in this chart.');
  const list = h('ol', { class: 'cp-timeline' });
  const asOf = chart.as_of;
  let year: string | null = null, marked = !asOf;
  const markAsOf = () => { marked = true; list.append(h('li', { class: 'cp-asof', 'data-meta': '' }, h('span', null, `Today in this chart · ${fmtDate(asOf)}`))); };
  for (const e of chart.encounters) {
    if (!marked && asOf && day(e.start) && day(e.start) <= asOf) markAsOf();
    const y = day(e.start).slice(0, 4) || 'Undated';
    if (y !== year) { year = y; list.append(h('li', { class: 'cp-year', 'data-meta': '' }, y)); }
    const linked = Object.entries(e.linked ?? {}).map(([type, n]) => `${n} ${n === 1 ? typeNoun(type) : typeNoun(type) + 's'}`).join(' · ');
    const text = [e.ref, e.start, e.end, fmtDate(e.start), e.label, e.where, e.status, linked, visitClass(e)].join(' ');
    // The linked-record counts are secondary: they live in the tooltip (and the filter text), the status shows only when unusual.
    const button = rowButton(e.ref, text,
      h('span', { class: 'cp-rec-top' }, h('span', { class: 'cp-kind' }, visitClass(e)), h('span', { class: 'cp-rec-title' }, e.type_text || 'Visit'),
        h('span', { class: 'cp-rec-date' }, dateRange(e.start, e.end))),
      e.reason || e.where ? h('span', { class: 'cp-rec-sub' }, joined([e.reason, e.where])) : null,
      e.status && e.status !== 'finished' ? h('span', { class: 'cp-rec-meta' }, e.status) : null);
    button.title = [e.ref, e.status, linked ? 'Linked: ' + linked : 'Nothing else links here'].filter(Boolean).join('\n');
    list.append(h('li', { class: 'cp-enc' }, button));
  }
  if (!marked) markAsOf();
  return list;
}

function documents(docs: DocItem[], kinds: Record<string, number>): Child {
  if (!docs.length) return emptyLine('No notes or reports in this chart.');
  const present = Object.keys(KIND).filter((k) => kinds[k]);
  if (!present.includes(ui.docKind)) ui.docKind = 'all';
  const chips = present.length < 2 ? null : h('div', { class: 'cp-chips', role: 'group', 'aria-label': 'Show reports, notes or documents' },
    ['all', ...present].map((kind) => h('button', { type: 'button', class: 'chip', 'data-kind-filter': kind, 'aria-pressed': String(ui.docKind === kind),
      onclick: () => {
        ui.docKind = kind;
        for (const b of root?.querySelectorAll<HTMLElement>('[data-kind-filter]') ?? []) b.setAttribute('aria-pressed', String(b.dataset.kindFilter === kind));
        applyFilter();
      } }, kind === 'all' ? 'All' : KINDS[kind], h('span', { class: 'cp-chip-n' }, fmtNum(kind === 'all' ? docs.length : kinds[kind] ?? 0)))));
  const rows = docs.map((d) => {
    const text = [d.ref, d.date, fmtDate(d.date), d.label, d.status, ...d.authors, d.snippet, KIND[d.kind]].join(' ');
    const button = rowButton(d.ref, text,
      h('span', { class: 'cp-rec-top' }, h('span', { class: 'cp-kind' }, KIND[d.kind] ?? 'Document'), h('span', { class: 'cp-rec-title' }, d.label || cap(typeNoun(d.type))),
        h('span', { class: 'cp-rec-date' }, fmtDate(d.date) || 'undated')),
      h('span', { class: 'cp-rec-meta' }, joined([d.status, d.authors.join(', '), d.encounter ? `visit ${fmtDate(d.encounter.date) || d.encounter.ref}` : null])),
      d.snippet ? h('span', { class: 'cp-rec-snippet' }, d.snippet) : null);
    button.dataset.kind = d.kind;
    return h('li', null, button);
  });
  return [chips, h('ul', { class: 'cp-reclist' }, rows)];
}

function groups(list: ChartGroup[], hooks: RecordsHooks): Child {
  const out: HTMLElement[] = [];
  let scope: string | null = null;
  for (const g of list) {
    if (g.scope !== scope) { scope = g.scope; out.push(h('div', { class: 'cp-subhead' }, SCOPES[scope] ?? scope)); }
    const key = `${g.scope}|${g.type}`;
    const path = g.scope === 'own' ? searchPath(g.type) : null;
    const node = h('details', { class: 'cp-group', open: ui.openGroups.has(key) },
      h('summary', null,
        h('span', { class: 'cp-caret', 'aria-hidden': 'true' }),
        h('span', { class: 'cp-group-name' }, cap(typeNoun(g.type))), h('span', { class: 'dev-only mono xs muted' }, g.type),
        h('span', { class: 'spacer' }),
        path ? h('button', { type: 'button', class: 'btn ghost sm dev-only', title: 'GET ' + path,
          onclick: (event: MouseEvent) => { event.preventDefault(); hooks.console(path); } }, svg(ICON.code), 'Console') : null,
        h('span', { class: 'cp-count' }, fmtNum(g.count))),
      h('ul', { class: 'cp-reclist compact' }, g.records.map((r) => h('li', null, rowButton(r.ref,
        [r.ref, r.date, fmtDate(r.date), r.label, r.status, typeNoun(g.type)].join(' '),
        h('span', { class: 'cp-rec-top' }, h('span', { class: 'cp-rec-title' }, r.label || h('span', { class: 'mono muted' }, r.ref)),
          h('span', { class: 'cp-rec-date' }, fmtDate(r.date) || '—')),
        r.status ? h('span', { class: 'cp-rec-meta' }, r.status) : null)))));
    // Groups the filter opened are not remembered as opened by the user.
    node.addEventListener('toggle', () => { if (!node.dataset.auto) { if (node.open) ui.openGroups.add(key); else ui.openGroups.delete(key); } });
    out.push(node);
  }
  return out;
}

/** Render the full chart into `body`, with the filter field and the count line above it. */
export function renderRecords(body: HTMLElement, chart: FullChart, hooks: RecordsHooks): void {
  const kinds: Record<string, number> = {};
  for (const d of chart.documents) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
  overview = [plural(chart.total, 'record'), plural(chart.encounters.length, 'visit'),
    ...Object.keys(KIND).filter((k) => kinds[k]).map((k) => `${kinds[k]} ${((kinds[k] === 1 ? KIND[k] : KINDS[k]) ?? '').toLowerCase()}`)].join(' · ');
  const input = h('input', { type: 'search', class: 'cp-search-input', placeholder: 'Filter by text, type or date', 'aria-label': 'Filter the records', value: ui.query, autocomplete: 'off', spellcheck: 'false' });
  input.addEventListener('input', () => { ui.query = input.value; applyFilter(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; ui.query = ''; applyFilter(); } });
  countLine = h('div', { class: 'cp-search-count', 'aria-live': 'polite' });
  root = h('div', { class: 'cp-records' },
    chartSection('encounters', 'Visits', chart.encounters.length, timeline(chart)),
    chartSection('documents', 'Notes and reports', chart.documents.length, documents(chart.documents, kinds)),
    chartSection('records', 'All records by type', chart.total, groups(chart.groups, hooks)));
  body.replaceChildren(
    h('div', { class: 'cp-search' }, h('label', { class: 'cp-search-field' }, svg(ICON.search), input), countLine),
    root);
  applyFilter();
}

function applyFilter(): void {
  if (!root) return;
  const query = ui.query.trim().toLowerCase();
  let matches = 0;
  for (const node of root.querySelectorAll<HTMLElement>('[data-text]')) {
    const kindOk = !node.dataset.kind || ui.docKind === 'all' || node.dataset.kind === ui.docKind;
    const hide = !kindOk || (!!query && !(node.dataset.text ?? '').includes(query));
    (node.closest('li') ?? node).hidden = hide;
    node.dataset.hit = hide ? '0' : '1';
    if (!hide && node.closest('.cp-group')) matches += 1;
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-meta]')) node.hidden = !!query;
  for (const section of root.querySelectorAll<HTMLElement>(':scope > details.cp-sec')) { // "3 of 14" while filtering
    const count = section.querySelector<HTMLElement>(':scope > summary .cp-count');
    if (!count) continue;
    const total = Number(count.dataset.total);
    const shown = section.querySelectorAll('[data-hit="1"]').length;
    count.textContent = query || shown !== total ? `${fmtNum(shown)} of ${fmtNum(total)}` : fmtNum(total);
  }
  for (const group of root.querySelectorAll<HTMLDetailsElement>('details.cp-group')) {
    const hits = group.querySelectorAll('[data-hit="1"]').length;
    group.hidden = !!query && !hits;
    if (query && hits && !group.open) { group.dataset.auto = '1'; group.open = true; }
    if (!query && group.dataset.auto) { group.open = false; delete group.dataset.auto; }
  }
  if (countLine) countLine.textContent = query ? plural(matches, 'matching record') : overview;
}
