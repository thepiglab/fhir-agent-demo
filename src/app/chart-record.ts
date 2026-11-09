// The chart panel's Record tab: one record as a readable list of fields, what it links to and
// what links to it, the raw JSON, and (developer mode) a link graph. Back/forward walk the trail
// of records opened since the patient was chosen.
import { h, fill, svg, fmtDate, fmtNum, plural, cap, clip, joined, highlight, emptyLine, failure } from './dom.ts';
import type { Child } from './dom.ts';
import { ICON } from './icons.ts';
import { app, api, isRef, typeNoun } from './state.ts';
import type { Attachment, Fact, Link, RecordView, ResultRow, Section } from './chart-types.ts';

export interface RecordHooks {
  /** Show the Record tab (and update its label). */
  show(): void;
  /** The trail changed (the Record tab's label follows the current record). */
  trail(): void;
  /** Run a GET in the console (developer mode). */
  console(path: string): void;
}

let hooks: RecordHooks;
const state = { trail: [] as string[], index: -1, view: null as RecordView | null, stale: false, seq: 0 };

const back = h('button', { type: 'button', class: 'btn ghost icon sm', title: 'Previous record', 'aria-label': 'Previous record', disabled: true, onclick: () => move(-1) }, svg(ICON.arrowLeft));
const forward = h('button', { type: 'button', class: 'btn ghost icon sm', title: 'Next record', 'aria-label': 'Next record', disabled: true, onclick: () => move(1) }, svg(ICON.arrowRight));
const crumbs = h('nav', { class: 'cp-crumbs', 'aria-label': 'Records opened' });
const body = h('div', { class: 'cp-record' });
export const recordView: HTMLElement = h('div', { class: 'cp-record-wrap' }, h('div', { class: 'cp-trailbar' }, back, forward, crumbs), body);

export function initRecord(h_: RecordHooks): void { hooks = h_; renderTrail(); }

export const currentRef = (): string | null => state.trail[state.index] ?? null;
export const hasTrail = (): boolean => state.trail.length > 0;
/** The short label of the current record, for the tab. */
export function currentLabel(): string {
  const ref = currentRef();
  if (!ref) return 'Record';
  const type = ref.split('/')[0] ?? '';
  return app.dev ? type : cap(typeNoun(type));
}
export function resetTrail(): void {
  state.trail = []; state.index = -1; state.view = null; state.stale = false; state.seq += 1;
  renderTrail();
}
export function markRecordStale(): void { state.stale = true; }
export const recordStale = (): boolean => state.stale;

function renderTrail(): void {
  back.disabled = state.index <= 0;
  forward.disabled = state.index >= state.trail.length - 1;
  if (!state.trail.length) {
    crumbs.replaceChildren();
    fill(body, h('div', { class: 'empty' }, 'Open a record from the summary, the records list or an answer\'s sources to see what it says and what it links to.'));
    return;
  }
  const first = Math.max(0, state.trail.length - 5);
  const items = state.trail.slice(first).map((key, i) => {
    const index = first + i, [type = '', id = ''] = key.split('/');
    const text = app.dev ? `${type}/${clip(id, 8)}` : cap(typeNoun(type));
    return index === state.index ? h('span', { class: 'cp-crumb current', 'aria-current': 'page', title: key }, text)
      : h('button', { type: 'button', class: 'cp-crumb', title: key, onclick: () => { state.index = index; void open(key, { record: false }); } }, text);
  });
  fill(crumbs, first ? h('span', { class: 'cp-crumb-sep' }, '…') : null,
    items.flatMap((item, i) => (i ? [h('span', { class: 'cp-crumb-sep', 'aria-hidden': 'true' }, svg(ICON.chevronRight)), item] : [item])));
  hooks?.trail();
}

/** Open a record (adding it to the trail unless `record` is false) and show the Record tab. */
export async function open(key: string, { record = true, show = true } = {}): Promise<void> {
  const patient = app.patient;
  if (!patient || !key) return;
  if (record && state.trail[state.index] !== key) {
    state.trail = [...state.trail.slice(0, state.index + 1), key];
    state.index = state.trail.length - 1;
  }
  state.stale = false;
  renderTrail();
  if (show) hooks.show();
  const seq = ++state.seq;
  body.setAttribute('aria-busy', 'true');
  const same = state.view?.ref === key;
  if (!same) fill(body, skeleton());
  try {
    const view = await api<RecordView>('/api/resource', { patient: patient.id, ref: key });
    if (seq !== state.seq) return; // superseded
    const scroller = body.closest('.scroll');
    const scroll = same && scroller ? scroller.scrollTop : 0;
    render(view);
    if (scroller) scroller.scrollTop = scroll;
  } catch (error) {
    if (seq !== state.seq) return;
    state.view = null;
    fill(body, failure('Could not open this record: ' + (error instanceof Error ? error.message : String(error)), () => void open(key, { record: false })));
  } finally {
    if (seq === state.seq) body.removeAttribute('aria-busy');
  }
}
export function reloadRecord(): void {
  state.stale = false;
  const key = currentRef();
  if (key) void open(key, { record: false, show: false });
}
/** Developer mode changed: show or hide the technical parts. */
export function rerenderRecord(): void {
  renderTrail();
  if (state.view) render(state.view);
}
function move(delta: number): void {
  const index = state.index + delta;
  if (index < 0 || index >= state.trail.length) return;
  state.index = index;
  void open(state.trail[index] ?? '', { record: false });
}

const skeleton = (): HTMLElement => h('div', { class: 'cp-skel-wrap', 'aria-label': 'Opening the record' },
  h('div', { class: 'cp-skel w30' }), h('div', { class: 'cp-skel w70 tall' }), h('div', { class: 'cp-skel w40' }),
  h('div', { class: 'cp-skel-gap' }), ...[60, 80, 50, 70, 40].map((w) => h('div', { class: `cp-skel w${w}` })));

// ---------- the record ----------
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;
const REF_IN_TEXT = /\b[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]{1,64}/g;
const WHERE: Record<string, string> = { own: "This patient's record", shared: 'Shared record, not tied to a patient', other: "Another patient's record" };

const recordLink = (ref: string, text?: string | null): HTMLElement => h('a', { href: '#', class: 'cp-ref', 'data-ref': ref, title: 'Open ' + ref }, text || ref);
/** Text with Type/id references turned into links. */
function prose(text: string): Child[] {
  const parts: Child[] = [];
  let last = 0;
  for (const m of text.matchAll(REF_IN_TEXT)) {
    if (!isRef(m[0])) continue;
    parts.push(text.slice(last, m.index), recordLink(m[0]));
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}
/** A fact's value: a date reads as a date; a status code reads as words; references link. */
function scalar(text: string | undefined): Child {
  if (text === undefined || text === null || text === '') return h('span', { class: 'muted' }, 'not recorded');
  if (DATE_VALUE.test(text)) return fmtDate(text, { time: true });
  if (isRef(text)) return recordLink(text);
  if (/^[a-z]+(-[a-z]+)+$/.test(text)) return text.replace(/-/g, ' ');
  return prose(text);
}
function refLink(item: Link): Child {
  if (!item.exists) return h('span', { class: 'mono muted', title: 'Not a record in this chart' }, item.ref);
  return h('span', { class: 'cp-reflink' }, recordLink(item.ref, item.label || cap(typeNoun(item.type))),
    h('span', { class: 'muted xs' }, ' ' + typeNoun(item.type)), h('span', { class: 'dev-only mono muted xs' }, ' ' + item.ref));
}
const block = (title: string, ...children: Child[]): HTMLElement =>
  h('section', { class: 'cp-block' }, h('h4', { class: 'cp-label' }, title), ...children);

function facts(list: Fact[]): HTMLElement {
  return h('dl', { class: 'cp-dl' }, list.map((f) => h('div', { class: 'cp-dl-row' },
    h('dt', null, h('span', { class: 'basic-only' }, f.label || f.field), h('span', { class: 'dev-only mono' }, f.field)),
    h('dd', null, f.refs ? joined(f.refs.map(refLink), ', ') : scalar(f.text)))));
}
function resultsTable(rows: ResultRow[]): HTMLElement {
  return h('div', { class: 'cp-table-wrap' }, h('table', { class: 'cp-table' },
    h('thead', null, h('tr', null, ['Test', 'Value', 'Flag', 'Range', 'Date', 'Status'].map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', null, rows.map((row) => (row.exists
      ? h('tr', null,
        h('th', { scope: 'row', style: row.depth ? `padding-left:${row.depth * 16}px` : null }, recordLink(row.ref, row.name)),
        h('td', null, row.value || (row.members ? h('span', { class: 'muted' }, `panel of ${row.members}`) : '')),
        h('td', null, row.flag ? h('span', { class: 'cp-flag f-' + row.flag }, row.flag) : null),
        h('td', { class: 'muted' }, row.range), h('td', { class: 'nowrap muted' }, fmtDate(row.date)), h('td', { class: 'muted' }, row.status))
      : h('tr', null, h('td', { colspan: 6, class: 'mono muted' }, `${row.ref} (not in this chart)`)))))));
}
function attachment(a: Attachment, fallback: string): HTMLElement {
  const json = /json/i.test(a.content_type ?? '');
  return block(a.title || fallback,
    h('div', { class: 'cp-meta' }, joined([a.content_type || 'no content type', typeof a.bytes === 'number' ? plural(a.bytes, 'byte') : null, a.language,
      a.creation ? 'created ' + fmtDate(a.creation) : null])),
    a.text === null ? null : json ? h('pre', { class: 'json cp-doc', html: highlight(a.text, isRef) }) : h('pre', { class: 'cp-doc' }, a.text),
    a.truncated && a.text ? h('div', { class: 'cp-meta' }, `Showing the first ${fmtNum(a.text.length)} characters.`) : null,
    a.note ? h('div', { class: 'cp-meta' }, a.note) : null,
    a.url ? h('div', { class: 'cp-meta' }, 'URL ', h('code', null, a.url)) : null);
}
function sectionNode(s: Section): HTMLElement {
  return h('div', { class: 'cp-docsec', style: s.depth ? `margin-left:${s.depth * 16}px` : null },
    h('div', { class: 'cp-docsec-title' }, s.title || 'Untitled section'),
    s.text ? h('div', { class: 'cp-docsec-text' }, s.text) : null,
    s.entries.length ? h('ul', { class: 'cp-links' }, s.entries.map(linkItem)) : null);
}
function linkItem(item: Link): HTMLElement {
  const name = item.exists ? h('a', { href: '#', class: 'cp-ref', 'data-ref': item.ref, title: item.ref }, item.label || cap(typeNoun(item.type)))
    : h('span', { class: 'mono xs muted', title: 'Not a record in this chart' }, item.ref);
  return h('li', { class: 'cp-link' },
    h('div', { class: 'cp-link-top' }, name, h('span', { class: 'spacer' }), item.date ? h('span', { class: 'cp-link-date' }, fmtDate(item.date)) : null),
    h('div', { class: 'cp-link-meta' },
      item.path ? [h('span', { class: 'basic-only' }, item.relation ? item.relation + ' · ' : ''), h('span', { class: 'dev-only mono' }, item.path + ' · ')] : null,
      cap(typeNoun(item.type || 'external')), h('span', { class: 'dev-only mono' }, ' · ' + item.ref)));
}
/** Long lists are grouped by field and type; the graph's grouped nodes open these groups. */
function linkList(items: Link[], side: 'in' | 'out'): Child {
  if (!items.length) return emptyLine(side === 'in' ? 'No record in this chart links here.' : 'It links to no other record.');
  if (items.length <= 12) return h('ul', { class: 'cp-links' }, items.map(linkItem));
  const groups = new Map<string, Link[]>();
  for (const item of items) {
    const key = `${side}|${item.type}|${item.path}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups].map(([key, list]) => {
    const first = list[0];
    return h('details', { class: 'disclosure cp-linkgroup', 'data-group': key, open: list.length <= 3 },
      h('summary', null, h('span', { class: 'basic-only' }, first?.relation ? first.relation + ' · ' : ''), h('span', { class: 'dev-only mono' }, (first?.path ?? '') + ' · '),
        cap(typeNoun(first?.type || 'external')), h('span', { class: 'cp-count' }, String(list.length))),
      h('ul', { class: 'cp-links' }, list.map(linkItem)));
  });
}
function linkColumns(view: RecordView): HTMLElement {
  return h('div', { class: 'cp-linkcols' },
    h('div', null, h('div', { class: 'cp-subhead' }, `Links to this · ${view.incoming.length}`), linkList(view.incoming, 'in')),
    h('div', null, h('div', { class: 'cp-subhead' }, `This links to · ${view.outgoing.length}`), linkList(view.outgoing, 'out')));
}

function render(view: RecordView): void {
  state.view = view;
  const r = view.readable;
  const head = h('header', { class: 'cp-rec-head' },
    h('div', { class: 'cp-rec-kicker' },
      h('span', { class: 'cp-rec-type' }, cap(typeNoun(view.type))),
      h('span', { class: 'dev-only badge' }, view.type),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn ghost sm dev-only', title: 'GET ' + view.ref, onclick: () => hooks.console(view.ref) }, svg(ICON.code), 'Console')),
    h('h3', { class: 'cp-rec-name' }, view.label || cap(typeNoun(view.type))),
    h('div', { class: 'cp-meta' }, joined([fmtDate(view.date, { time: true }), view.status, WHERE[view.scope]])),
    h('code', { class: 'dev-only cp-rec-ref' }, view.ref));
  const parts: Child[] = [head];
  if (view.scope === 'other') parts.push(h('div', { class: 'alert warn' }, `This record belongs to another patient in the same data shard (${view.owner ?? 'unknown'}).`));
  if (r.facts.length) parts.push(block('Details', facts(r.facts)));
  if (r.conclusion) parts.push(block('Conclusion', h('p', { class: 'cp-prose' }, r.conclusion)));
  if (r.results?.length) parts.push(block(view.type === 'Observation' ? 'Panel members' : 'Results', resultsTable(r.results)));
  for (const a of r.attachments ?? []) parts.push(attachment(a, view.type === 'DiagnosticReport' ? 'Presented form' : 'Attachment'));
  if (r.sections?.length) parts.push(block('Sections', r.sections.map(sectionNode)));
  parts.push(block(`Linked records · ${view.incoming.length + view.outgoing.length}`, app.dev ? linkGraph(view) : null, linkColumns(view)));
  if (r.narrative) parts.push(h('details', { class: 'disclosure cp-raw' }, h('summary', null, 'Narrative'), h('div', { class: 'cp-prose muted cp-narrative' }, r.narrative)));
  parts.push(h('details', { class: 'disclosure cp-raw', open: app.dev },
    h('summary', null, 'Raw record (FHIR JSON)'),
    h('pre', { class: 'json', html: highlight(JSON.stringify(view.resource, null, 2) ?? 'null', isRef) })));
  fill(body, h('article', { class: 'cp-rec-article' }, parts));
}

// ---------- link graph (developer mode): what links here (left), the record, what it links to (right) ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
type SvgAttrs = Record<string, string | number | null | undefined>;
function sv(tag: string, attrs: SvgAttrs = {}, ...children: (Node | string | null)[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  for (const child of children) if (child !== null) node.append(child);
  return node;
}
interface GNode { ref?: string; type?: string | null; label?: string | null; exists?: boolean; paths: string[]; key?: string; members?: GNode[]; more?: number }
/** One node per linked record; past `max`, one per type and field, then a remainder. */
function graphNodes(items: Link[], side: string, max = 6): GNode[] {
  const byRef = new Map<string, GNode>();
  for (const item of items) {
    const node = byRef.get(item.ref) ?? { ref: item.ref, type: item.type, label: item.label, exists: item.exists, paths: [] };
    const p = item.path ?? '';
    if (!node.paths.includes(p)) node.paths.push(p);
    byRef.set(item.ref, node);
  }
  const nodes = [...byRef.values()];
  if (nodes.length <= max) return nodes;
  const groups = new Map<string, GNode & { members: GNode[] }>();
  for (const node of nodes) {
    const key = `${side}|${node.type}|${node.paths[0]}`;
    const g = groups.get(key) ?? { key, type: node.type, paths: [node.paths[0] ?? ''], members: [] };
    g.members.push(node);
    groups.set(key, g);
  }
  const size = (n: GNode) => n.members?.length ?? 1;
  const out: GNode[] = [...groups.values()].map((g) => (g.members.length === 1 ? g.members[0] ?? g : g)).sort((a, b) => size(b) - size(a));
  if (out.length > max) out.push({ more: out.splice(max - 1).reduce((n, g) => n + size(g), 0), paths: [] });
  return out;
}
function graphNode(node: GNode, x: number, y: number, width: number, height: number, chars: number): SVGElement {
  let title: string, via = `via ${node.paths.join(', ')}`, sub: string, tip: string;
  const attrs: SvgAttrs = {};
  if (node.more !== undefined) {
    [title, via, sub, tip] = [`+${node.more} more`, '', 'listed below', `${node.more} more linked records`];
    attrs['data-more'] = '1';
  } else if (node.members) {
    const count = ` ×${node.members.length}`;
    title = clip(node.type || 'External', chars - count.length) + count;
    sub = 'open the list';
    tip = node.members.slice(0, 15).map((m) => (m.ref ?? '') + (m.label ? ' · ' + m.label : '')).join('\n') + (node.members.length > 15 ? '\n…' : '');
    attrs['data-group'] = node.key;
  } else {
    title = node.type || 'External';
    sub = node.exists ? node.label || (node.ref ?? '').split('/').pop() || '' : 'not in this chart';
    tip = `${node.ref} (${via})${node.label ? '\n' + node.label : ''}`;
    if (node.exists && node.ref) attrs['data-node-ref'] = node.ref;
  }
  const active = Object.keys(attrs).length > 0;
  return sv('g', { class: 'g-node' + (active ? ' link' : ''), transform: `translate(${x},${y})`, tabindex: active ? 0 : null, role: active ? 'button' : null,
    'aria-label': active ? tip.split('\n')[0] : null, ...attrs },
  sv('title', {}, tip), sv('rect', { width, height, rx: 8 }),
  sv('text', { x: 9, y: 15, class: 'g-type' }, clip(title, chars)),
  sv('text', { x: 9, y: 28, class: 'g-path' }, clip(via, chars + 3)),
  sv('text', { x: 9, y: 40, class: 'g-sub' }, clip(sub, chars + 2)));
}
function linkGraph(view: RecordView): HTMLElement {
  const left = graphNodes(view.incoming, 'in'), right = graphNodes(view.outgoing, 'out');
  const width = Math.round(Math.max(360, Math.min(900, body.clientWidth || 400)));
  const nodeW = Math.round(Math.min(200, width * 0.29)), gap = (width - 3 * nodeW) / 2;
  const nodeH = 48, rowH = 56, top = 24, centerH = 52;
  const rows = Math.max(left.length, right.length, 2), height = top + rows * rowH;
  const chars = Math.floor((nodeW - 16) / 6.2);
  const cx = nodeW + gap, cy = top + (rows * rowH - centerH) / 2, cmid = cy + centerH / 2;
  const arrow = 'g-arrow-' + Math.random().toString(36).slice(2, 8);
  const root = sv('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `${view.ref} is referenced by ${view.incoming.length} and references ${view.outgoing.length} records; the lists below hold every link.` },
  sv('defs', {}, sv('marker', { id: arrow, viewBox: '0 0 8 8', refX: 7.5, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' },
    sv('path', { d: 'M0,0 L8,4 L0,8 z', class: 'g-arrowhead' }))),
  sv('text', { x: 0, y: 12, class: 'g-head' }, 'LINKS HERE'),
  sv('text', { x: width, y: 12, class: 'g-head', 'text-anchor': 'end' }, 'LINKS TO'));
  const column = (nodes: GNode[]): [GNode, number][] => nodes.map((node, i) => [node, top + ((rows - nodes.length) * rowH) / 2 + i * rowH + (rowH - nodeH) / 2]);
  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    sv('path', { class: 'g-edge', d: `M${x1},${y1} C${x1 + gap / 2},${y1} ${x2 - gap / 2},${y2} ${x2},${y2}`, 'marker-end': `url(#${arrow})` });
  const nodes: SVGElement[] = [];
  for (const [node, y] of column(left)) { root.append(curve(nodeW, y + nodeH / 2, cx, cmid)); nodes.push(graphNode(node, 0, y, nodeW, nodeH, chars)); }
  for (const [node, y] of column(right)) { root.append(curve(cx + nodeW, cmid, width - nodeW, y + nodeH / 2)); nodes.push(graphNode(node, width - nodeW, y, nodeW, nodeH, chars)); }
  if (!left.length) nodes.push(sv('text', { x: nodeW / 2, y: cmid + 4, class: 'g-sub', 'text-anchor': 'middle' }, 'nothing'));
  if (!right.length) nodes.push(sv('text', { x: width - nodeW / 2, y: cmid + 4, class: 'g-sub', 'text-anchor': 'middle' }, 'nothing'));
  root.append(...nodes, sv('g', { class: 'g-node g-center', transform: `translate(${cx},${cy})` },
    sv('title', {}, view.ref), sv('rect', { width: nodeW, height: centerH, rx: 9 }),
    sv('text', { x: 9, y: 16, class: 'g-type' }, clip(view.type, chars)),
    sv('text', { x: 9, y: 30, class: 'g-sub' }, clip(view.label || '', chars + 2)),
    sv('text', { x: 9, y: 43, class: 'g-id' }, clip(view.ref.split('/')[1] ?? '', chars + 2))));
  const box = h('div', { class: 'cp-graph' }, root);
  // Record nodes open the record; grouped nodes open their group in the lists below.
  const activate = (node: Element) => {
    const el = node as SVGElement;
    if (el.dataset.nodeRef) { void open(el.dataset.nodeRef); return; }
    const group = el.dataset.group ? [...body.querySelectorAll<HTMLDetailsElement>('.cp-linkgroup')].find((g) => g.dataset.group === el.dataset.group) : undefined;
    if (group) group.open = true;
    (group ?? body.querySelector('.cp-linkcols'))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const target = (event: Event) => (event.target instanceof Element ? event.target.closest('[data-node-ref], [data-group], [data-more]') : null);
  box.addEventListener('click', (event) => { const node = target(event); if (node) activate(node); });
  box.addEventListener('keydown', (event) => {
    const node = target(event);
    if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate(node); }
  });
  return box;
}
