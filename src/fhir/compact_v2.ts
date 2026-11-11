// Port of harness Lc (fhir_suite_harness profile "Lc" = CProfile(compact=2)) at 7da3ad1:
//   render.py            sha256 9fab6f8cd7d93ae8a08dc4e1a58de8a764eddc095241e03a57bcd907c35d35cf
//                        (render_compact_v2, compact_row_v2, compact_value_v2, SEARCH_FOOTER_V2)
//   profiles/c_parts.py  sha256 b44b46c410cd9ec8d6ad8bb9b5b02dc26c63aaf98ae609b4df99ffd3d6fe56fa
//                        (lc_system_prompt, PROMPT_HEADER, PROMPT_COMPACT_V2)
//
// Lc is L with one change to what the model sees: a successful searchset Bundle renders as one
// compact line per record instead of JSON, and the system prompt gains one harness section.
// Reads by id, writes, errors and every other result stay L's exact JSON text. Field values longer
// than 300 characters are cut with a "GET Type/id" marker, and such a field is not exposed: the
// scorer credits only fields the rendering showed in full (exposure is deferred, as X16's).
// Golden parity: tests/lc.test.ts against tests/parity/fixtures/lc-golden.jsonl.gz (the Python).

import { PyFloat, pyDumps } from './pyjson.ts';
import { hasOwn, isDict, pyHead, pyLen, pyStr, pyStrip, truthy } from './pyrt.ts';
import type { Rec } from './pyrt.ts';

const DROPPED = new Set(['meta', 'text', 'extension', 'modifierExtension', 'implicitRules', 'language']);
const IDENTITY = new Set(['resourceType', 'id']);
export const VALUE_LIMIT = 300;
export const SEARCH_FOOTER_V2 = "Compact rows; GET Type/id returns a record's full JSON.";

const PROMPT_HEADER = 'Harness behavior:';
const PROMPT_COMPACT_V2 =
  '- Compact search results: one line per record (field=value; vN is meta.versionId). ' +
  "A value longer than 300 characters is cut; GET Type/id returns a record's full JSON.";

/** The system prompt Lc shows (L's plus one harness section). */
export function lcSystemPrompt(system: string): string {
  const section = [PROMPT_HEADER, PROMPT_COMPACT_V2].join('\n');
  return system ? `${system}\n\n${section}` : section;
}

export interface RenderedResult {
  text: string;
  /** ref -> the top-level fields shown in full */
  exposed: Map<string, Set<string>>;
  raw_chars: number;
}

const get = (o: Rec, key: string, fallback: unknown = undefined): unknown => (hasOwn(o, key) ? o[key] : fallback);
/** set(value) <= allowed */
const keysWithin = (o: Rec, allowed: readonly string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));
const isNumber = (v: unknown): boolean => typeof v === 'number' || v instanceof PyFloat;
const ref = (r: Rec): string => `${pyStr(r.resourceType)}/${pyStr(r.id)}`;

/** json.dumps(value, ensure_ascii=False, separators=(",", ":")). */
function dumpsCompact(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(dumpsCompact).join(',') + ']';
  if (isDict(value)) return '{' + Object.entries(value).map(([k, v]) => pyDumps(k) + ':' + dumpsCompact(v)).join(',') + '}';
  return pyDumps(value);
}

function scalar(value: unknown): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return pyStrip(value) ? value : pyDumps(value);
  return pyStr(value);
}

function coding(c: Rec): string {
  const system = get(c, 'system', ''), code = get(c, 'code', '');
  const head = truthy(system) ? `${pyStr(system)}|${pyStr(code)}` : pyStr(code);
  const display = get(c, 'display');
  return truthy(display) ? `${head} "${pyStr(display)}"` : head;
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** base64.b64decode(data, validate=True).decode("utf-8"), or null where Python raises. */
function decodeText(data: unknown): string | null {
  if (typeof data !== 'string' || !B64.test(data) || data.length % 4 !== 0) return null;
  try {
    return UTF8.decode(Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

function attachment(a: Rec): string {
  const parts: unknown[] = [get(a, 'contentType', '')];
  if (truthy(get(a, 'title'))) parts.push(`title="${pyStr(a.title)}"`);
  const data = get(a, 'data');
  const join = (items: unknown[]) => items.filter(truthy).map(pyStr).join(' ');
  if (data === null || data === undefined) {
    if (truthy(get(a, 'url'))) parts.push(`url=${pyStr(a.url)}`);
    return join(parts);
  }
  const decoded = decodeText(data);
  if (decoded === null || !pyStr(get(a, 'contentType', 'text/')).startsWith('text/')) {
    return join([...parts, `[${pyLen(String(data))} base64 chars]`]);
  }
  return join([...parts, `text="${decoded}"`]);
}

/** compact_value_v2: (rendering, complete) for one field value. */
export function compactValueV2(value: unknown): [string, boolean] {
  if (Array.isArray(value)) {
    const rendered = value.map(compactValueV2);
    return [rendered.map(([r]) => r).join('; '), rendered.every(([, ok]) => ok)];
  }
  if (!isDict(value)) return [scalar(value), true];
  const has = (k: string) => hasOwn(value, k);
  if (has('coding') || (has('text') && keysWithin(value, ['text', 'coding']))) {
    const codings = get(value, 'coding', []) as Rec[];
    const codes = codings.map(coding);
    const text = get(value, 'text');
    if (truthy(text) && !codings.some((c) => get(c, 'display') === text)) codes.push(`text="${pyStr(text)}"`);
    return [codes.join(', '), true];
  }
  if (has('reference') && keysWithin(value, ['reference', 'display', 'type', 'identifier'])) {
    let out = pyStr(value.reference);
    if (truthy(get(value, 'display'))) out += ` "${pyStr(value.display)}"`;
    return [out, true];
  }
  if (keysWithin(value, ['system', 'code', 'display', 'version', 'userSelected']) && has('code')) return [coding(value), true];
  if (has('value') && keysWithin(value, ['value', 'unit', 'system', 'code', 'comparator']) && isNumber(value.value)) {
    // a Quantity (an Identifier's value is a string)
    const unit = [get(value, 'unit'), get(value, 'code')].find(truthy) ?? '';
    return [pyStrip(`${pyStr(get(value, 'comparator', ''))}${scalar(value.value)} ${pyStr(unit)}`), true];
  }
  if (keysWithin(value, ['start', 'end'])) return [`${pyStr(get(value, 'start', ''))}..${pyStr(get(value, 'end', ''))}`, true];
  if (keysWithin(value, ['low', 'high', 'text', 'type', 'appliesTo', 'age']) && (has('low') || has('high'))) {
    const low = truthy(get(value, 'low')) ? compactValueV2(value.low)[0] : '';
    const high = truthy(get(value, 'high')) ? compactValueV2(value.high)[0] : '';
    const text = truthy(get(value, 'text')) ? ` "${pyStr(value.text)}"` : '';
    return [`${low}-${high}${text}`, true];
  }
  if (has('attachment') && isDict(value.attachment)) {
    const rendered = attachment(value.attachment);
    const rest = Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'attachment'));
    if (Object.keys(rest).length) {
      const [extra, ok] = compactValueV2(rest);
      return [`${rendered} ${extra}`, ok];
    }
    return [rendered, true];
  }
  if (has('data') && has('contentType')) return [attachment(value), true];
  if (has('system') && has('value') && keysWithin(value, ['system', 'value', 'use', 'type', 'period', 'assigner'])) {
    return [`${pyStr(value.system)}|${pyStr(value.value)}`, true];
  }
  return [dumpsCompact(value), true];
}

/** compact_row_v2: one line for a record and the top-level fields it shows in full. */
export function compactRowV2(resource: Rec): [string, Set<string>] {
  const key = ref(resource);
  const meta = get(resource, 'meta');
  const version = isDict(meta) ? get(meta, 'versionId') : undefined;
  const parts = [truthy(version) ? `${key} v${pyStr(version)}` : key];
  const shown = new Set([...IDENTITY].filter((f) => hasOwn(resource, f)));
  for (const [name, value] of Object.entries(resource)) {
    if (DROPPED.has(name) || IDENTITY.has(name)) continue;
    let [rendered, complete] = compactValueV2(value);
    const length = pyLen(rendered);
    if (length > VALUE_LIMIT) {
      rendered = `${pyHead(rendered, VALUE_LIMIT)}... [+${length - VALUE_LIMIT} chars; GET ${key}]`;
      complete = false;
    }
    parts.push(`${name}=${rendered}`);
    if (complete) shown.add(name);
  }
  return [parts.join(' | '), shown];
}

function addExposed(out: RenderedResult, key: string, fields: Iterable<string>): void {
  let set = out.exposed.get(key);
  if (!set) out.exposed.set(key, set = new Set());
  for (const f of fields) set.add(f);
}

/** render_compact_v2: Lc's text for one store.request result {status, headers, body}. */
export function renderCompactV2(result: Rec): RenderedResult {
  const text = pyDumps(result);  // the locked harness's text
  const out: RenderedResult = { text, exposed: new Map(), raw_chars: pyLen(text) };
  const body = get(result, 'body');
  const status = get(result, 'status');
  const search = typeof status === 'number' && Number.isInteger(status) && status < 300 && isDict(body)
    && get(body, 'resourceType') === 'Bundle' && get(body, 'type') === 'searchset';
  if (!search) {
    if (isDict(body)) {
      const resources = get(body, 'resourceType') === 'Bundle'
        ? (get(body, 'entry', []) as Rec[]).filter((e) => hasOwn(e, 'resource')).map((e) => e.resource as Rec)
        : truthy(get(body, 'id')) ? [body] : [];
      for (const r of resources) addExposed(out, ref(r), Object.keys(r));
    }
    return out;
  }
  const bundle = body as Rec;
  const entries = get(bundle, 'entry', []) as Rec[];
  const lines = [`HTTP ${status}`, `Bundle searchset total=${pyStr(get(bundle, 'total', entries.length))}, ${entries.length} entries in this page`];
  for (const link of get(bundle, 'link', []) as Rec[]) {
    const relation = get(link, 'relation');
    if (relation === 'next' || relation === 'previous' || relation === 'prev') lines.push(`${relation}: ${pyStr(get(link, 'url', ''))}`);
  }
  for (const entry of entries) {
    const resource = get(entry, 'resource');
    if (!isDict(resource) || !truthy(get(resource, 'resourceType'))) {
      lines.push(dumpsCompact(entry));
      continue;
    }
    let [line, shown] = compactRowV2(resource);
    const search = get(entry, 'search');
    if (isDict(search) && get(search, 'mode') === 'include') line += ' | (included)';
    addExposed(out, ref(resource), shown);
    lines.push(line);
  }
  if (entries.length) lines.push(SEARCH_FOOTER_V2);
  out.text = lines.join('\n');
  return out;
}
