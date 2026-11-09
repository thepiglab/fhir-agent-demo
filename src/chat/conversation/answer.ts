// Reading a run's answer for display: the model's final JSON (trace.final.shown) becomes a list of
// blocks (a stat, fields, tables, a trend, prose) that AnswerView draws as generative UI.
// Values always come from the answer or from the chart's records; nothing is computed that the
// records do not hold, except a trend's difference between two recorded values.
import { humanize, unitText } from '../../app/dom.ts';
import type { AnswerPath, Claim, SourceRow } from '../../chart/trace.ts';
import type { RecordView } from './hooks.ts';
import type { RunTrace } from './types.ts';

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
export const pathKey = (path: AnswerPath): string => JSON.stringify(path);
const isNum = (v: unknown): boolean => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()));
const isScalar = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const DATE = /^\d{4}-\d{2}(-\d{2})?(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;
export const isDate = (v: unknown): boolean => typeof v === 'string' && DATE.test(v);

/** What the answer's renderer needs besides the answer. */
export interface Ctx {
  names: Record<string, string>;
  claims: Map<string, Claim>;
  sources: Map<string, SourceRow>;
  records: Map<string, RecordView>;
}
export function context(trace: RunTrace, records: Map<string, RecordView>): Ctx {
  return {
    names: trace.final?.names ?? {},
    claims: new Map((trace.final?.claims ?? []).map((c) => [pathKey(c.path), c])),
    sources: new Map((trace.sources ?? []).map((r) => [r.ref, r])),
    records,
  };
}
/** Every reference the answer leans on: cited evidence and each claim's sources. */
export function answerRefs(trace: RunTrace): string[] {
  const refs = new Set<string>(trace.final?.evidence ?? []);
  for (const claim of trace.final?.claims ?? []) for (const ref of claim.sources) refs.add(ref);
  return [...refs].filter((r) => /^[A-Z][A-Za-z]+\/[A-Za-z0-9.-]{1,64}$/.test(r)).sort();
}

// ---------- measurements ----------
/** A measured value as the answer states it: {value, unit?, date?, code?/name?...}. */
export interface Measurement { value: number; unit: string; date: string | null; name: string | null; status: string | null; extra: [string, unknown][] }
const NAME_KEYS = ['name', 'test', 'analyte', 'display', 'title', 'code', 'lab', 'measurement', 'type'];
const DATE_KEYS = ['date', 'effective', 'effective_date', 'effectivedatetime', 'datetime', 'when', 'time', 'issued', 'collected', 'resulted'];
/** FHIR plumbing a reply sometimes echoes; not worth showing next to a value. */
const NOISE = new Set(['resourcetype', 'id', 'meta', 'subject', 'patient', 'encounter', 'reference', 'text', 'identifier', 'basedon', 'specimen', 'performer']);

export function measurement(v: unknown, ctx: Ctx): Measurement | null {
  if (!isObj(v) || !isNum(v.value)) return null;
  const unit = typeof v.unit === 'string' ? v.unit : '';
  const dateKey = Object.keys(v).find((k) => DATE_KEYS.includes(k.toLowerCase()) && isDate(v[k]));
  if (!unit && !dateKey) return null;
  const nameKey = Object.keys(v).find((k) => NAME_KEYS.includes(k.toLowerCase()) && typeof v[k] === 'string');
  const rawName = nameKey ? String(v[nameKey]) : null;
  const used = new Set(['value', 'unit', dateKey, nameKey, 'status']);
  return {
    value: Number(v.value), unit, date: dateKey ? String(v[dateKey]) : null,
    name: rawName ? ctx.names[rawName] ?? rawName : null,
    status: typeof v.status === 'string' ? v.status : null,
    extra: Object.entries(v).filter(([k, x]) => !used.has(k) && !NOISE.has(k.toLowerCase()) && (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') && !(isDate(x) && dateKey)),
  };
}

/** What a chart record says, for Observations with a numeric value. */
export interface RecordFacts { ref: string; name: string; code: string; value: number | null; unit: string; date: string | null; status: string; low: number | null; high: number | null }
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export function recordFacts(view: RecordView | undefined): RecordFacts | null {
  if (!view) return null;
  const r = view.resource ?? {};
  const code = isObj(r.code) ? r.code : {};
  const coding = Array.isArray(code.coding) && isObj(code.coding[0]) ? code.coding[0] : {};
  const q = isObj(r.valueQuantity) ? r.valueQuantity : null;
  const range = Array.isArray(r.referenceRange) && isObj(r.referenceRange[0]) ? r.referenceRange[0] : null;
  const bound = (b: unknown): number | null => (isObj(b) && isNum(b.value) ? Number(b.value) : null);
  const name = (view.label || '').split(':')[0]?.trim() || str(code.text) || str(coding.display) || view.ref;
  const period = isObj(r.effectivePeriod) ? r.effectivePeriod : {};
  return {
    ref: view.ref, name, code: str(coding.code) || str(code.text) || name,
    value: q && isNum(q.value) ? Number(q.value) : null, unit: q ? str(q.unit) || str(q.code) : '',
    date: str(r.effectiveDateTime) || str(period.start) || str(r.issued) || view.date,
    status: str(r.status) || view.status || '',
    low: range ? bound(range.low) : null, high: range ? bound(range.high) : null,
  };
}

// ---------- trends ----------
export interface TrendPoint { ref: string | null; date: string; value: number; status: string | null; path: AnswerPath | null }
export interface Trend { name: string; unit: string; points: TrendPoint[]; low: number | null; high: number | null; fromRecords: boolean }

const time = (d: string): number => Date.parse(d.length === 10 ? d + 'T00:00:00Z' : d);

/** Measurements in the answer with their paths (fields, list items, the answer itself). */
function answerMeasurements(shown: unknown, ctx: Ctx): { path: AnswerPath; m: Measurement }[] {
  const out: { path: AnswerPath; m: Measurement }[] = [];
  const visit = (v: unknown, path: AnswerPath, depth: number) => {
    const m = measurement(v, ctx);
    if (m) { out.push({ path, m }); return; }
    if (depth > 2) return;
    if (Array.isArray(v)) v.forEach((item, i) => visit(item, [...path, i], depth + 1));
    else if (isObj(v)) for (const [k, item] of Object.entries(v)) visit(item, [...path, k], depth + 1);
  };
  visit(shown, [], 0);
  return out;
}

/**
 * A trend when the cited records hold two or more numeric results of one test (their values,
 * from the chart), else when the answer itself lists two or more dated values in one unit.
 */
export function findTrend(trace: RunTrace, ctx: Ctx): Trend | null {
  const cited = new Set(trace.final?.evidence ?? []);
  const groups = new Map<string, RecordFacts[]>();
  for (const ref of cited) {
    const f = recordFacts(ctx.records.get(ref));
    if (!f || f.value === null || !f.date || !ref.startsWith('Observation/')) continue;
    const key = `${f.code}|${f.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  const found = answerMeasurements(trace.final?.shown, ctx);
  const pathOf = (value: number, date: string | null): AnswerPath | null =>
    found.find(({ m }) => m.value === value && (!m.date || !date || m.date.slice(0, 10) === date.slice(0, 10)))?.path ?? null;
  if (best && best.length >= 2) {
    const points = best.map((f) => ({ ref: f.ref, date: f.date!, value: f.value!, status: f.status, path: pathOf(f.value!, f.date) }))
      .sort((a, b) => time(a.date) - time(b.date));
    const last = best.find((f) => f.ref === points.at(-1)!.ref)!;
    return { name: last.name, unit: last.unit, points, low: last.low, high: last.high, fromRecords: true };
  }
  const byUnit = new Map<string, { path: AnswerPath; m: Measurement }[]>();
  for (const item of found) {
    if (!item.m.date) continue;
    const key = `${item.m.name ?? ''}|${item.m.unit}`;
    byUnit.set(key, [...(byUnit.get(key) ?? []), item]);
  }
  const series = [...byUnit.values()].sort((a, b) => b.length - a.length)[0];
  if (!series || series.length < 2) return null;
  const points = series.map(({ path, m }) => {
    const claim = ctx.claims.get(pathKey(path));
    return { ref: claim?.sources[0] ?? null, date: m.date!, value: m.value, status: m.status, path };
  }).sort((a, b) => time(a.date) - time(b.date));
  const ref = points.at(-1)!.ref;
  const facts = ref ? recordFacts(ctx.records.get(ref)) : null;
  return { name: series[0]!.m.name ?? facts?.name ?? 'Values', unit: series[0]!.m.unit, points, low: facts?.low ?? null, high: facts?.high ?? null, fromRecords: false };
}

/** Answer paths a trend already shows (its measurements, and lists made only of them). */
export function trendCovers(trend: Trend, trace: RunTrace, ctx: Ctx): Set<string> {
  const covered = new Set<string>();
  const values = new Set(trend.points.map((p) => p.value));
  for (const { path, m } of answerMeasurements(trace.final?.shown, ctx)) {
    if ((m.unit === trend.unit || !m.unit) && values.has(m.value)) covered.add(pathKey(path));
  }
  return covered;
}

// ---------- blocks ----------
export interface StatBlock {
  kind: 'stat'; label: string; value: unknown; unit: string; sub: string[]; path: AnswerPath; extra: [string, unknown][];
  /** The record's reference range as words ("12 to 16 g/dL"), and whether the value is outside it. */
  range?: string | null; flag?: 'low' | 'high' | null;
}
export interface FieldsBlock { kind: 'fields'; rows: { label: string; value: unknown; path: AnswerPath }[] }
export interface TableBlock { kind: 'table'; title: string | null; path: AnswerPath; columns: { key: string; label: string }[]; rows: { path: AnswerPath; item: Obj }[] }
export interface ListBlock { kind: 'list'; title: string | null; path: AnswerPath; items: { path: AnswerPath; value: unknown }[] }
export type Block =
  | StatBlock | FieldsBlock | TableBlock | ListBlock
  | { kind: 'prose'; text: string }
  | { kind: 'trend'; trend: Trend };

const GENERIC = new Set(['value', 'answer', 'result', 'results', 'response', 'output', 'data']);
const STATUS_WORDS: Record<string, string> = { corrected: 'corrected', amended: 'amended', preliminary: 'preliminary', 'entered-in-error': 'entered in error', cancelled: 'cancelled', registered: 'registered' };
export const statusWord = (s: string | null | undefined): string => (s ? STATUS_WORDS[s] ?? '' : '');

/** The record that states this part of the answer (its first source that is not the patient). */
export function claimRecord(path: AnswerPath, ctx: Ctx): RecordFacts | null {
  const claim = ctx.claims.get(pathKey(path));
  for (const ref of claim?.sources ?? []) {
    if (ref.startsWith('Patient/')) continue;
    const f = recordFacts(ctx.records.get(ref));
    if (f) return f;
  }
  return null;
}

/** A cited record holding exactly this number (when no claim points at the part itself). */
function recordWithValue(value: number, ctx: Ctx, cited: string[]): RecordFacts | null {
  for (const ref of cited) {
    const f = recordFacts(ctx.records.get(ref));
    if (f && f.value === value) return f;
  }
  return null;
}

/** The record's reference range as words, and low or high when the value falls outside it. */
export function rangeOf(value: number | null, facts: RecordFacts | null): { range: string | null; flag: 'low' | 'high' | null } {
  if (!facts || (facts.low === null && facts.high === null)) return { range: null, flag: null };
  const unit = unitText(facts.unit);
  const u = unit ? (unit === '%' ? ' %' : ' ' + unit) : '';
  const range = facts.low !== null && facts.high !== null ? `${facts.low} to ${facts.high}${u}`
    : facts.low !== null ? `at least ${facts.low}${u}` : `up to ${facts.high}${u}`;
  const flag = value === null ? null : facts.low !== null && value < facts.low ? 'low' : facts.high !== null && value > facts.high ? 'high' : null;
  return { range, flag };
}

function stat(value: unknown, at: AnswerPath, key: string | null, ctx: Ctx, cited: string[]): StatBlock {
  const m = measurement(value, ctx);
  // The claim may sit on the part or, for {value, unit, date}, on its value field.
  const path = ctx.claims.get(pathKey(at))?.sources.length || !m ? at : [...at, 'value'];
  const num = m ? m.value : isNum(value) ? Number(value) : null;
  const facts = claimRecord(path, ctx) ?? (num !== null ? recordWithValue(num, ctx, cited) : null);
  const keyLabel = key && !GENERIC.has(key.toLowerCase()) ? humanize(key) : '';
  if (m) {
    const date = m.date ?? facts?.date ?? null;
    return {
      kind: 'stat', label: m.name ?? facts?.name ?? keyLabel, value: m.value, unit: m.unit || facts?.unit || '', path,
      sub: [date ?? '', statusWord(m.status ?? facts?.status)].filter(Boolean), extra: m.extra, ...rangeOf(m.value, facts),
    };
  }
  const sameValue = facts && facts.value !== null && isNum(value) && Number(value) === facts.value;
  return {
    kind: 'stat', label: keyLabel || facts?.name || '', value, unit: sameValue ? facts.unit : '', path,
    sub: sameValue ? [facts.date ?? '', statusWord(facts.status)].filter(Boolean) : [], extra: [],
    ...(sameValue ? rangeOf(facts.value, facts) : {}),
  };
}

function arrayBlock(list: unknown[], path: AnswerPath, title: string | null, covered: Set<string>): Block | null {
  const items = list.map((value, i) => ({ path: [...path, i], value })).filter((it) => !covered.has(pathKey(it.path)));
  if (list.length && !items.length) return null;
  if (items.length && items.every((it) => isObj(it.value))) {
    const keys: string[] = [];
    for (const it of items) for (const k of Object.keys(it.value as Obj)) if (!keys.includes(k)) keys.push(k);
    // value and unit read as one column; a name-like key leads.
    const cols = keys.filter((k) => !(k === 'unit' && keys.includes('value')));
    const lead = cols.find((k) => NAME_KEYS.includes(k.toLowerCase()));
    const ordered = lead ? [lead, ...cols.filter((k) => k !== lead)] : cols;
    return { kind: 'table', title, path, columns: ordered.map((k) => ({ key: k, label: humanize(k) })), rows: items.map((it) => ({ path: it.path, item: it.value as Obj })) };
  }
  return { kind: 'list', title, path, items };
}

/** Fewer points than this draw no line worth reading: the values go in a short table instead. */
export const MIN_CHART_POINTS = 3;

/** A trend too short to chart, as a table: date, value and any status other than final. */
export function trendTable(trend: Trend): TableBlock {
  const status = trend.points.some((p) => statusWord(p.status));
  const columns = [{ key: 'date', label: 'Date' }, { key: 'value', label: trend.name }];
  if (status) columns.push({ key: 'status', label: 'Status' });
  return {
    kind: 'table', title: null, path: [], columns,
    rows: trend.points.map((p, i) => ({
      path: p.path ?? ['trend', i],
      item: { date: p.date.slice(0, 10), value: p.value, unit: trend.unit, ...(status ? { status: statusWord(p.status) || 'final' } : {}) },
    })),
  };
}

/** The blocks of an answer, in reading order. */
export function plan(trace: RunTrace, ctx: Ctx): Block[] {
  const shown = trace.final?.shown;
  if (typeof shown === 'string') return [{ kind: 'prose', text: shown }];
  const trend = findTrend(trace, ctx);
  const covered = trend ? trendCovers(trend, trace, ctx) : new Set<string>();
  const blocks: Block[] = trend ? [trend.points.length >= MIN_CHART_POINTS ? { kind: 'trend', trend } : trendTable(trend)] : [];
  if (isScalar(shown) || measurement(shown, ctx)) {
    if (!covered.has(pathKey([]))) blocks.push(stat(shown, [], null, ctx, trace.final?.evidence ?? []));
    return blocks;
  }
  if (Array.isArray(shown)) {
    const block = arrayBlock(shown, [], null, covered);
    if (block) blocks.push(block);
    return blocks;
  }
  if (!isObj(shown)) return blocks;
  const entries = Object.entries(shown).filter(([k]) => !covered.has(pathKey([k])));
  const arrays = entries.filter(([, v]) => Array.isArray(v));
  const others = entries.filter(([, v]) => !Array.isArray(v));
  if (!trend && entries.length === 1 && others.length === 1 && (isScalar(others[0]![1]) || measurement(others[0]![1], ctx))) {
    blocks.push(stat(others[0]![1], [others[0]![0]], others[0]![0], ctx, trace.final?.evidence ?? []));
    return blocks;
  }
  if (others.length) blocks.push({ kind: 'fields', rows: others.map(([k, v]) => ({ label: humanize(k), value: v, path: [k] })) });
  for (const [k, v] of arrays) {
    const block = arrayBlock(v as unknown[], [k], humanize(k), covered);
    if (block) blocks.push(block);
  }
  return blocks;
}
