// The chart panel's Summary tab: the patient card (allergies, code status, alerts, problems,
// medications) and the summary sections (labs, vitals, visits, notes, appointments, orders,
// medications, problems). Every row is a [data-ref] button the panel opens in the Record tab.
import { h, fmtNum, fmtDate, dateRange, cap, joined, unitText, plural, storage, emptyLine, svg } from './dom.ts';
import { ICON } from './icons.ts';
import type { Child } from './dom.ts';
import { typeNoun } from './state.ts';
import type { ChartPatient } from '../types.ts';
import type { Allergy, Appointment, DocItem, Encounter, Item, Medication, Order, Point, Problem, Series, Summary } from './chart-types.ts';

export const CLASSES: Record<string, string> = {
  AMB: 'Outpatient', EMER: 'Emergency', IMP: 'Inpatient', ACUTE: 'Inpatient', NONAC: 'Inpatient', OBSENC: 'Observation',
  PRENC: 'Pre-admission', SS: 'Short stay', HH: 'Home health', VR: 'Virtual', FLD: 'Field',
};
export const KIND: Record<string, string> = { report: 'Report', note: 'Note', composition: 'Document' };
export const KINDS: Record<string, string> = { report: 'Reports', note: 'Notes', composition: 'Documents' };
const FLAGS: Record<string, string> = { H: 'High', L: 'Low', HH: 'Critically high', LL: 'Critically low', A: 'Abnormal' };
const TRENDS: Record<string, string> = { up: '↑', down: '↓', same: '→' };

export const visitClass = (e: Encounter): string => (e.class_code && CLASSES[e.class_code]) || cap(e.class) || 'Visit';

/** What the summary remembers while the patient stays the same. */
const ui = { expanded: new Set<string>(), openSeries: new Set<string>(), labsAll: false };
export function resetSummaryState(): void { ui.expanded.clear(); ui.openSeries.clear(); ui.labsAll = false; }

// ---------- marks ----------
/** A value's flag: the record's interpretation, its own range, or a typical adult range (dashed). */
export function flagMark(point: Point | null | undefined): HTMLElement | null {
  if (!point?.flag) return null;
  const why = point.flag_source === 'typical range' ? `outside a typical adult range (${point.range}); the result has no range of its own`
    : point.flag_source === 'record range' ? `outside the result's reference range (${point.range})` : 'as the result is interpreted in the record';
  const name = FLAGS[point.flag] ?? point.flag;
  return h('span', { class: `cp-flag f-${point.flag}${point.flag_source === 'typical range' ? ' typical' : ''}`, title: `${name}: ${why}` },
    point.flag, h('span', { class: 'sr-only' }, ` (${name})`));
}
function trendMark(row: Series): HTMLElement | null {
  if (!row.trend || !row.previous) return null;
  const words = row.trend === 'same' ? 'unchanged' : `${row.trend} ${Math.abs(row.change ?? 0)} ${unitText(row.latest.unit)}`.trim();
  return h('span', { class: `cp-trend t-${row.trend}`, title: `${cap(words)} since the result before (${fmtDate(row.previous.date)})` },
    h('span', { 'aria-hidden': 'true' }, TRENDS[row.trend] ?? ''), h('span', { class: 'sr-only' }, ` ${words}`));
}
/** A value as recorded (13.0 stays 13.0, comparators stay), with a readable unit. */
const pointText = (point: Point, bp = false): string => (point.value !== null && point.value !== undefined && !bp
  ? `${(point.text ?? '').split(' ')[0] || point.value} ${unitText(point.unit)}` : `${point.text || '—'}${bp ? ' ' + unitText(point.unit) : ''}`).trim();
const valueLink = (point: Point, quiet = false): HTMLElement =>
  h('a', { href: '#', class: 'cp-value' + (quiet ? ' quiet' : ''), 'data-ref': point.ref, title: `Open this result (${fmtDate(point.date) || 'undated'})` }, pointText(point));

// ---------- patient card ----------
function allergyTitle(a: Allergy): string {
  return joined([a.reactions.length ? 'Reaction: ' + a.reactions.join(', ') : null, a.criticality ? 'Criticality: ' + a.criticality : null,
    a.verification ? 'Verification: ' + a.verification : null, a.date ? 'Recorded ' + fmtDate(a.date) : null], '\n').join('') || a.text;
}
/** A label/value row. */
const fact = (label: Child, value: Child, cls = ''): HTMLElement =>
  h('div', { class: 'cp-fact ' + cls }, h('dt', null, label), h('dd', null, value));
const none = (text: string, title?: string): HTMLElement => h('span', { class: 'muted', title }, text);
/** Record names as a comma-separated run of links (allergies, code status). */
const inlineLinks = <T extends { ref: string; text: string }>(items: T[], title: (item: T) => string, cls = ''): Child =>
  joined(items.map((x) => h('a', { href: '#', class: 'cp-inline ' + cls, 'data-ref': x.ref, title: title(x) }, x.text)), ', ');

/** Problems or medications: one per line, the first few, then a quiet "+N more". */
function itemList<T extends Item>(key: string, label: string, items: T[], title: (item: T) => string, rerender: () => void): HTMLElement {
  const open = ui.expanded.has(key), limit = 4;
  const shown = open || items.length <= limit + 1 ? items : items.slice(0, limit);
  const toggle = items.length > shown.length || open
    ? h('button', { type: 'button', class: 'cp-more-btn', 'aria-expanded': String(open),
      onclick: () => { if (open) ui.expanded.delete(key); else ui.expanded.add(key); rerender(); } },
    open ? 'Show fewer' : `+${items.length - shown.length} more`)
    : null;
  return h('section', { class: 'cp-items', 'aria-label': label },
    h('h3', { class: 'cp-label' }, label, items.length ? h('span', { class: 'cp-n' }, fmtNum(items.length)) : null),
    items.length
      ? h('ul', { class: 'cp-itemlist' }, shown.map((item) => h('li', null, h('a', { href: '#', 'data-ref': item.ref, title: title(item) }, item.text))))
      : h('p', { class: 'cp-none' }, 'None recorded'),
    toggle);
}

export function patientCard(p: ChartPatient, s: Summary | null, rerender: () => void): HTMLElement {
  const demo = joined([p.age !== null && p.age !== undefined ? `${p.age} y` : null, p.gender ? cap(p.gender) : null,
    p.birth_date ? `born ${fmtDate(p.birth_date)}` : null]);
  const head = h('header', { class: 'cp-pt-head' },
    h('h2', { class: 'cp-pt-name' }, p.name),
    h('p', { class: 'cp-pt-meta' }, demo.length ? demo : 'Sex not recorded'),
    h('p', { class: 'cp-pt-meta' }, 'MRN ', h('span', { class: 'mono' }, p.mrn || 'none'),
      h('span', { class: 'cp-sep' }, ' · '), h('span', { title: 'The chart is read as of this date, which the assistant treats as today.' }, 'as of ', fmtDate(p.as_of) || 'unknown')));
  if (!s) return h('section', { class: 'cp-pt' }, head);
  const a = s.allergies;
  const allergies: Child = a.items.length ? inlineLinks(a.items, allergyTitle, 'err')
    : a.none_known.length ? inlineLinks(a.none_known, allergyTitle)
      : none('None recorded', 'This chart has no allergy record. That is not the same as no known allergies.');
  const code: Child = s.code_status
    ? h('a', { href: '#', class: 'cp-inline', 'data-ref': s.code_status.ref, title: s.code_status.date ? 'Recorded ' + fmtDate(s.code_status.date) : '' }, s.code_status.text)
    : none('Not documented', 'No code status record (observation, alert or consent) in this chart');
  const alerts = s.alerts.length
    ? h('ul', { class: 'cp-alerts', 'aria-label': 'Alerts' }, s.alerts.map((x) => h('li', null,
      svg(ICON.alert), h('a', { href: '#', 'data-ref': x.ref, title: x.date ? 'Alert since ' + fmtDate(x.date) : 'Alert' }, x.text))))
    : null;
  return h('section', { class: 'cp-pt', 'aria-label': 'Patient' }, head, alerts,
    h('dl', { class: 'cp-facts' },
      fact('Allergies', allergies, a.items.length ? 'has-allergy' : ''),
      fact('Code status', code)),
    itemList<Problem>('problems', 'Problems', s.problems,
      (x) => joined([x.clinical_status ? 'Status: ' + x.clinical_status : 'No clinical status recorded', x.date ? fmtDate(x.date) : null]).join(''), rerender),
    itemList<Medication>('medications', 'Medications', s.medications,
      (x) => joined([x.dose, x.source === 'reported' ? 'Reported by the patient' : 'Prescription', x.status]).join(''), rerender));
}

// ---------- summary sections ----------
const OPEN_BY_DEFAULT = new Set(['labs', 'vitals', 'visits']);
function section(key: string, title: string, count: number, body: Child): HTMLElement {
  const saved = storage.get<Record<string, boolean>>('chart-sections', {});
  const node = h('details', { class: 'disclosure cp-sec', open: saved[key] ?? OPEN_BY_DEFAULT.has(key) },
    h('summary', null, h('span', { class: 'cp-sec-title' }, title), h('span', { class: 'cp-count' }, fmtNum(count))),
    h('div', { class: 'cp-sec-body' }, body));
  node.addEventListener('toggle', () => {
    const now = storage.get<Record<string, boolean>>('chart-sections', {});
    now[key] = node.open;
    storage.set('chart-sections', now);
  });
  return node;
}
const more = (text: string, onclick: () => void): HTMLElement => h('button', { type: 'button', class: 'linklike cp-more', onclick }, text);

/** A record row: date column, main text with a sub line, status on the right. */
function row(ref: string, at: Child, what: Child, status: Child, sub?: Child): HTMLElement {
  return h('li', null, h('button', { type: 'button', class: 'cp-row', 'data-ref': ref },
    h('span', { class: 'cp-row-at' }, at),
    h('span', { class: 'cp-row-main' }, h('span', { class: 'cp-row-what' }, what), sub ? h('span', { class: 'cp-row-sub' }, sub) : null),
    status ? h('span', { class: 'cp-row-status' }, status) : null));
}
/** "Outpatient · Follow-up": the kind in quiet text, then the name. */
const kindThen = (kind: string, text: string | null | undefined): Child[] =>
  [h('span', { class: 'cp-kind' }, kind), text ? h('span', null, text) : null];
const list = (items: HTMLElement[], cls = ''): HTMLElement => h('ul', { class: 'cp-list ' + cls }, items);

function labTable(labs: Series[], rerender: () => void): Child {
  if (!labs.length) return emptyLine('No lab results in this chart.');
  const shown = ui.labsAll ? labs : labs.slice(0, 8);
  const rows = shown.flatMap((r) => {
    const open = ui.openSeries.has(r.code), latest = r.latest, previous = r.previous;
    const toggle = () => { if (open) ui.openSeries.delete(r.code); else ui.openSeries.add(r.code); rerender(); };
    const out: HTMLElement[] = [h('tr', { class: open ? 'open' : '' },
      h('th', { scope: 'row' }, r.count > 1
        ? h('button', { type: 'button', class: 'cp-series', 'aria-expanded': String(open), title: `Show every ${r.name} result`, onclick: toggle },
          h('span', { class: 'cp-caret', 'aria-hidden': 'true' }), r.name, h('span', { class: 'cp-times' }, `×${r.count}`))
        : h('span', { class: 'cp-series static' }, r.name)),
      h('td', null, h('div', { class: 'nowrap' }, valueLink(latest), flagMark(latest), trendMark(r)), h('div', { class: 'cp-lab-date' }, fmtDate(latest.date))),
      h('td', null, previous ? [h('div', { class: 'nowrap' }, valueLink(previous, true)), h('div', { class: 'cp-lab-date' }, fmtDate(previous.date))]
        : h('span', { class: 'muted' }, '—')))];
    if (open) {
      out.push(h('tr', { class: 'cp-points' }, h('td', { colspan: 3 },
        h('ul', { 'aria-label': `${r.name} results, newest first` },
          r.points.map((point) => h('li', null, h('span', { class: 'muted' }, fmtDate(point.date)), h('span', null, valueLink(point), flagMark(point)),
            h('span', { class: 'muted' }, point.status && point.status !== 'final' ? point.status : '')))),
        r.count > r.points.length ? h('div', { class: 'muted xs' }, `Showing the latest ${r.points.length} of ${r.count}.`) : null)));
    }
    return out;
  });
  const dashed = (point: Point | null) => !!point?.flag && point.flag_source === 'typical range';
  const typical = shown.some((r) => dashed(r.latest) || (ui.openSeries.has(r.code) && r.points.some(dashed)));
  return [
    h('div', { class: 'cp-table-wrap' }, h('table', { class: 'cp-table cp-lab' },
      h('thead', null, h('tr', null, ['Test', 'Latest', 'Previous'].map((c) => h('th', { scope: 'col' }, c)))), h('tbody', null, rows))),
    labs.length > 8 ? more(ui.labsAll ? 'Show fewer tests' : `Show all ${labs.length} tests`, () => { ui.labsAll = !ui.labsAll; rerender(); }) : null,
    h('p', { class: 'cp-legend' }, 'H high, L low. Arrows compare the latest result with the one before.',
      typical ? ' A dashed flag uses a typical adult range because the result has no range of its own.' : ''),
  ];
}
function vitalTiles(vitals: Series[]): Child {
  if (!vitals.length) return emptyLine('No vital signs in this chart.');
  return h('div', { class: 'cp-vitals' }, vitals.map((r) => {
    const bp = r.kind === 'bp', latest = r.latest;
    return h('button', { type: 'button', class: 'cp-vital', 'data-ref': latest.ref, title: `Open this reading (${r.name})` },
      h('span', { class: 'cp-vital-name' }, r.name),
      h('span', { class: 'cp-vital-val' }, pointText(latest, bp), flagMark(latest), trendMark(r)),
      h('span', { class: 'cp-vital-meta' }, joined([fmtDate(latest.date), r.previous ? `before ${pointText(r.previous, bp)}` : null])));
  }));
}
function visitList(visits: Summary['encounters'], toRecords: () => void): Child {
  if (!visits.total) return emptyLine('No visits in this chart.');
  return [list(visits.recent.map((e) => row(e.ref, dateRange(e.start, e.end),
    kindThen(visitClass(e), e.type_text || e.reason), e.status,
    e.reason || e.where ? joined([e.type_text ? e.reason : null, e.where]).join('') : null))),
  visits.total > visits.recent.length ? more(`All ${visits.total} visits`, toRecords) : null];
}
function noteList(documents: Summary['documents'], toRecords: () => void): Child {
  if (!documents.total) return emptyLine('No notes or reports in this chart.');
  return [list(documents.recent.map((d: DocItem) => row(d.ref, fmtDate(d.date) || 'undated',
    kindThen(KIND[d.kind] ?? 'Document', d.label || cap(typeNoun(d.type))), d.authors.join(', '), d.snippet))),
  documents.total > documents.recent.length ? more(`All ${documents.total} notes and reports`, toRecords) : null];
}
const appointmentRow = (a: Appointment): HTMLElement => row(a.ref, fmtDate(a.start, { time: true }) || 'no date',
  [a.what || 'Appointment', a.with.length ? h('span', { class: 'muted' }, ' with ' + a.with.join(', ')) : null], a.status);
function appointmentList(appointments: Summary['appointments']): Child {
  return [
    appointments.upcoming.length ? list(appointments.upcoming.map(appointmentRow))
      : emptyLine(appointments.total ? 'No upcoming appointments.' : 'No appointments in this chart.'),
    appointments.past.length ? [h('div', { class: 'cp-subhead' }, 'Earlier or not booked'), list(appointments.past.map(appointmentRow))] : null,
  ];
}
function orderList(orders: Order[]): Child {
  if (!orders.length) return emptyLine('No open orders.');
  return list(orders.map((o) => row(o.ref, o.ordered ? fmtDate(o.ordered) : 'no date', o.text, o.status,
    o.reports.length ? 'Report: ' + o.reports.map((r) => r.status).join(', ') : 'No report yet')));
}
function medicationList(medications: Medication[]): Child {
  if (!medications.length) return emptyLine('No active medications recorded.');
  return list(medications.map((m) => row(m.ref, fmtDate(m.date) || '—', m.text, m.source === 'reported' ? 'reported' : 'prescribed', m.dose)));
}
function problemList(problems: Problem[]): Child {
  if (!problems.length) return emptyLine('No problems recorded.');
  return list(problems.map((x) => row(x.ref, fmtDate(x.date) || '—', x.text, x.clinical_status || '')));
}

export function summarySections(s: Summary, rerender: () => void, toRecords: () => void): HTMLElement[] {
  return [
    section('labs', 'Labs', s.labs.length, labTable(s.labs, rerender)),
    section('vitals', 'Vital signs', s.vitals.length, vitalTiles(s.vitals)),
    section('visits', 'Recent visits', s.encounters.total, visitList(s.encounters, toRecords)),
    section('notes', 'Notes and reports', s.documents.total, noteList(s.documents, toRecords)),
    section('appointments', 'Upcoming appointments', s.appointments.upcoming.length, appointmentList(s.appointments)),
    section('orders', 'Open orders', s.orders.length, orderList(s.orders)),
    section('medications', 'Medications', s.medications.length, medicationList(s.medications)),
    section('problems', 'Problems', s.problems.length, problemList(s.problems)),
  ];
}

export const changesText = (n: number): string => plural(n, 'change');
