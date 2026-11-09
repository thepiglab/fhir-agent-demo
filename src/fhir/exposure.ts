// Port of fhir_suite_harness/exposure.py at 647729c (sha256 a14a7bb6a0148104a673db8a4db7691a84485d9b6d447208d900419a7ff5c41c)
//
// Exposure bookkeeping: which (record, field) pairs reached the model. The scorer credits a
// cited record only if its evidence fields were exposed (FhirStore.exposed). Harness X16
// exposes the records it shows in full (expose_fields) and attributes their JSON text
// (expose_text). Text attribution parses complete {...} objects and scans lines for record ids.
//
// One difference, documented: Python falls back to ast.literal_eval for fragments that are not
// JSON (Python reprs printed by code harnesses). X16 only ever passes JSON text, whose balanced
// fragments always parse as JSON, so the fallback is never reached here and is not ported.

import { PyFloat, pyDumps } from './pyjson.ts';
import { loadsStrict } from './protocol.ts';
import { pyDumpsAscii, pyEq, pyLen, pyStrip, isDict } from './pyrt.ts';
import type { Rec } from './pyrt.ts';
import { ref } from './validation.ts';
import type { FhirStore } from './store.ts';

const IDENTITY_FIELDS = new Set(['resourceType', 'id']);
const MAX_SCAN_CHARS = 400_000;
const MIN_ID_CHARS = 6;

/** Scalar leaves of a JSON value. */
function leaves(value: unknown): unknown[] {
  const out: unknown[] = [];
  const stack: unknown[] = [value];
  while (stack.length) {
    const item = stack.pop();
    if (isDict(item)) stack.push(...Object.values(item));
    else if (Array.isArray(item)) stack.push(...item);
    else if (item !== null && item !== undefined) out.push(item);
  }
  return out;
}

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T/;
const REFERENCE = /^[A-Z][A-Za-z]+\/([A-Za-z0-9\-.]+)$/;

/** Python repr/str of a float. */
function floatStr(v: number): string { return pyDumps(new PyFloat(v)); }

/** Text forms a leaf may take in printed output. */
function leafStrings(value: unknown): Set<string> {
  const forms = new Set<string>();
  for (const leaf of leaves(value)) {
    if (leaf === true) { forms.add('true'); forms.add('True'); }
    else if (leaf === false) { forms.add('false'); forms.add('False'); }
    else if (leaf instanceof PyFloat) {
      forms.add(floatStr(leaf.value));
      if (Number.isInteger(leaf.value)) forms.add(BigInt(leaf.value).toString());
    } else if (typeof leaf === 'number') {
      forms.add(String(leaf));
    } else if (typeof leaf === 'string' && pyStrip(leaf)) {
      forms.add(leaf);
      const escaped = pyDumpsAscii(leaf).slice(1, -1);
      if (escaped !== leaf) forms.add(escaped);
      const date = DATE_TIME.exec(leaf);
      if (date) forms.add(date[1]!);
      const reference = REFERENCE.exec(leaf);
      if (reference && pyLen(reference[1]!) >= MIN_ID_CHARS) forms.add(reference[1]!);
    }
  }
  return forms;
}

// '-' needs no escape outside a class (and \- is invalid with the u flag).
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Substring match; short forms must stand alone. */
function contains(text: string, form: string): boolean {
  if (pyLen(form) >= 4) return text.includes(form);
  return new RegExp(`(?<![\\p{L}\\p{N}_.])${escapeRegex(form)}(?![\\p{L}\\p{N}_.])`, 'u').test(text);
}

/** (start, end) code-point spans of every complete {...}, ignoring braces in strings. */
function balancedObjects(chars: string[]): [number, number][] {
  const spans: [number, number][] = [];
  const stack: number[] = [];
  let quote: string | null = null, escape = false;
  const n = Math.min(chars.length, MAX_SCAN_CHARS);
  for (let i = 0; i < n; i++) {
    const ch = chars[i]!;
    if (quote) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === quote) quote = null;
      else if (ch === '\n' && quote === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') stack.push(i);
    else if (ch === '}' && stack.length) spans.push([stack.pop()!, i + 1]);
  }
  return spans;
}

function parseObject(fragment: string): unknown {
  try { return loadsStrict(fragment); } catch { return null; }
}

function resourceDicts(value: unknown, out: Rec[]): void {
  if (isDict(value)) {
    if (typeof value.resourceType === 'string' && typeof value.id === 'string') out.push(value);
    for (const item of Object.values(value)) resourceDicts(item, out);
  } else if (Array.isArray(value)) {
    for (const item of value) resourceDicts(item, out);
  }
}

// Python str.splitlines() breaks at \r\n and at each of these.
const LINE_BREAKS = new RegExp('\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]');
/** Python str.splitlines(). */
function splitlines(text: string): string[] {
  return text.split(LINE_BREAKS).filter((_, i, all) => i < all.length - 1 || all[i] !== '');
}

/** Python's sorted() of strings (code-point order). */
const sortedPy = (items: Iterable<string>): string[] => [...items].sort((a, b) => {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
});

export class ExposureTracker {
  store: FhirStore;
  returned = new Map<string, Rec[]>();
  origin = new Map<string, number>();
  byId = new Map<string, string>();
  log: [number, string, string, string[]][] = [];
  private idPattern: RegExp | null = null;
  private formCache = new Map<string, Set<string>>();

  constructor(store: FhirStore) { this.store = store; }

  register(eventIndex: number, resources: Rec[]): void {
    for (const resource of resources) {
      const key = ref(resource);
      let versions = this.returned.get(key);
      if (!versions) this.returned.set(key, versions = []);
      if (!versions.some((v) => pyEq(v, resource))) versions.push(resource);
      if (!this.origin.has(key)) this.origin.set(key, eventIndex);
      const id = String(resource.id ?? '');
      if (pyLen(id) >= MIN_ID_CHARS && this.byId.get(id) !== key) {
        this.byId.set(id, key);
        this.idPattern = null;
      }
    }
  }

  logRefs(): Set<string> { return new Set(this.log.map((e) => e[2])); }

  exposeFields(key: string, fields: Iterable<string>, channel: string, turn: number): Set<string> {
    const versions = this.returned.get(key);
    if (!versions?.length) return new Set();
    const wanted = new Set(fields);
    const already = this.store.exposed.get(key) ?? new Set<string>();
    const fresh = new Set([...wanted].filter((f) => !already.has(f)));
    const resource = versions[versions.length - 1]!;
    this.store.observe(resource, sortedPy(wanted));
    const origin = this.origin.get(key);
    if (origin !== undefined && origin < this.store.events.length) {
      const event = this.store.events[origin]! as unknown as { exposed_fields?: Record<string, string[]> };
      const exposed = (event.exposed_fields ??= {});
      exposed[key] = sortedPy(new Set([...(exposed[key] ?? []), ...wanted]));
    }
    if (fresh.size) this.log.push([turn, channel, key, sortedPy(fresh)]);
    return fresh;
  }

  exposeText(text: string, channel: string, turn: number): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    if (!text || !this.returned.size) return out;
    const found = new Map<string, Set<string>>();
    const merge = (from: Map<string, Set<string>>) => {
      for (const [key, fields] of from) {
        let set = found.get(key);
        if (!set) found.set(key, set = new Set());
        for (const f of fields) set.add(f);
      }
    };
    merge(this.structured(text));
    merge(this.lines(text));
    for (const [key, fields] of found) {
      const fresh = this.exposeFields(key, new Set([...fields, ...IDENTITY_FIELDS]), channel, turn);
      if (fresh.size) out.set(key, fresh);
    }
    return out;
  }

  private forms(key: string, field: string): Set<string> {
    const versions = this.returned.get(key)!;
    const cacheKey = `${key}\u0000${field}\u0000${versions.length}`;
    let forms = this.formCache.get(cacheKey);
    if (!forms) {
      forms = new Set();
      for (const version of versions) if (Object.hasOwn(version, field)) for (const f of leafStrings(version[field])) forms.add(f);
      this.formCache.set(cacheKey, forms);
    }
    return forms;
  }

  private matches(key: string, field: string, text: string): boolean {
    for (const form of this.forms(key, field)) if (contains(text, form)) return true;
    return false;
  }

  private structured(text: string): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    if (!text.includes('resourceType')) return found;
    const chars = Array.from(text);
    for (const [start, end] of balancedObjects(chars)) {
      const fragment = chars.slice(start, end).join('');
      if (!fragment.includes('resourceType')) continue;
      const parsed = parseObject(fragment);
      if (parsed === null) continue;
      const candidates: Rec[] = [];
      resourceDicts(parsed, candidates);
      for (const candidate of candidates) {
        const key = `${candidate.resourceType as string}/${candidate.id as string}`;
        const versions = this.returned.get(key);
        if (!versions) continue;
        const fields = new Set<string>();
        for (const [name, value] of Object.entries(candidate)) {
          if (IDENTITY_FIELDS.has(name)) continue;
          if (versions.some((v) => Object.hasOwn(v, name) && pyEq(v[name], value))) fields.add(name);
          else if (versions.some((v) => Object.hasOwn(v, name))) {
            if (this.matches(key, name, pyDumps(value))) fields.add(name);
          }
        }
        let set = found.get(key);
        if (!set) found.set(key, set = new Set());
        for (const f of fields) set.add(f);
      }
    }
    return found;
  }

  private pattern(): RegExp | null {
    if (this.idPattern === null && this.byId.size) {
      const ids = [...this.byId.keys()].sort((a, b) => pyLen(b) - pyLen(a));  // stable, as Python's sorted
      this.idPattern = new RegExp(ids.map(escapeRegex).join('|'), 'u');
    }
    return this.idPattern;
  }

  private lines(text: string): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const pattern = this.pattern();
    if (pattern === null) return found;
    const head = Array.from(text);
    const scanned = head.length > MAX_SCAN_CHARS ? head.slice(0, MAX_SCAN_CHARS).join('') : text;
    for (const line of splitlines(scanned)) {
      const match = pattern.exec(line);
      if (!match) continue;
      const key = this.byId.get(match[0])!;
      const fields = new Set<string>();
      for (const version of this.returned.get(key)!) {
        for (const name of Object.keys(version)) {
          if (IDENTITY_FIELDS.has(name) || fields.has(name)) continue;
          if (this.matches(key, name, line)) fields.add(name);
        }
      }
      let set = found.get(key);
      if (!set) found.set(key, set = new Set());
      for (const f of fields) set.add(f);
    }
    return found;
  }
}
