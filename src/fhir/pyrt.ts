// Python runtime semantics the FHIR port needs to stay byte-exact with CPython: exception
// classes with Python's str(), repr(), truthiness, ==, ordering, int(), str.strip(),
// code-point string order, and the urllib.parse functions the store calls.
//
// Values are the JSON data model of pyParse: null, boolean, number (a Python int), PyFloat
// (a Python float), string, array (list) and plain objects (dict).
import { PyFloat, pyDumps } from './pyjson.ts';

export type Rec = { [key: string]: unknown };

// --- exceptions -----------------------------------------------------------------------------

/** A Python exception: `kind` is its class name; message is str(exception). */
export class PyError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
    this.name = kind;
  }
}
export class ValueError extends PyError { constructor(message: string) { super('ValueError', message); } }
/** A ValueError subclass in Python. */
export class UnicodeEncodeError extends ValueError {
  constructor(message: string) {
    super(message);
    Object.defineProperty(this, 'kind', { value: 'UnicodeEncodeError' });
    this.name = 'UnicodeEncodeError';
  }
}
export class TypeError_ extends PyError { constructor(message: string) { super('TypeError', message); } }
export class IndexError extends PyError { constructor(message: string) { super('IndexError', message); } }
/** str(KeyError(key)) is repr(key). */
export class KeyError extends PyError { constructor(key: unknown) { super('KeyError', pyRepr(key)); } }
/** Not caught by FhirStore.request: it propagates to the caller, as in Python. */
export class AttributeError extends PyError { constructor(message: string) { super('AttributeError', message); } }

// --- value helpers --------------------------------------------------------------------------

export const isDict = (v: unknown): v is Rec =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PyFloat);

export const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** dict.get(key) on a dict (undefined when absent; Python None is null). */
export function get(o: Rec, key: string): unknown {
  return hasOwn(o, key) ? o[key] : undefined;
}

/** dict[key]: KeyError when absent. */
export function sub(o: Rec, key: string): unknown {
  if (!hasOwn(o, key)) throw new KeyError(key);
  return o[key];
}

/** obj["key"] on any value: KeyError for a missing dict key, TypeError for non-dicts like CPython. */
export function subscript(o: unknown, key: string): unknown {
  if (isDict(o)) return sub(o, key);
  if (typeof o === 'string') throw new TypeError_("string indices must be integers, not 'str'");
  if (Array.isArray(o)) throw new TypeError_('list indices must be integers or slices, not str');
  throw new TypeError_(`'${pyTypeName(o)}' object is not subscriptable`);
}

export function pyTypeName(v: unknown): string {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'str';
  if (v instanceof PyFloat) return 'float';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (Array.isArray(v)) return 'list';
  return 'dict';
}

/** Python truthiness. */
export function truthy(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === '' || v === 0) return false;
  if (v instanceof PyFloat) return v.value !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}

// --- repr / str -----------------------------------------------------------------------------

const NONPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** repr() of a str. */
export function pyStrRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === quote || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0');
    else if (c < 0x7f) out += ch;
    else if (NONPRINTABLE.test(ch)) {
      out += c <= 0xff ? '\\x' + c.toString(16).padStart(2, '0')
        : c <= 0xffff ? '\\u' + c.toString(16).padStart(4, '0')
          : '\\U' + c.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return out + quote;
}

function floatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  return new PyFloat(x).toString();
}

/** repr() of a JSON-model value. */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v instanceof PyFloat) return floatRepr(v.value);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return floatRepr(v);
    return Math.abs(v) >= 1e21 ? BigInt(v).toString() : String(v);
  }
  if (typeof v === 'string') return pyStrRepr(v);
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
  if (isDict(v)) return '{' + Object.entries(v).map(([k, x]) => pyStrRepr(k) + ': ' + pyRepr(x)).join(', ') + '}';
  return String(v);
}

/** str(): strings as is, everything else its repr. */
export function pyStr(v: unknown): string {
  return typeof v === 'string' ? v : pyRepr(v);
}

/** Python's json.dumps(value) with its default ensure_ascii=True (used for byte counts). */
export function pyDumpsAscii(value: unknown): string {
  // pyDumps leaves DEL and non-ASCII characters raw; ensure_ascii escapes each UTF-16 unit.
  return pyDumps(value).replace(/[^\x20-\x7e]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

// --- strings --------------------------------------------------------------------------------

/** Code point ranges str.isspace() accepts; what str.strip() and the regex \s treat as whitespace. */
export const PY_SPACE_RANGES: [number, number][] = [
  [9, 13], [0x1c, 0x1f], [0x20, 0x20], [0x85, 0x85], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000],
];
const hex4 = (c: number): string => '\\u' + c.toString(16).padStart(4, '0');
/** The same ranges as the body of a regex character class. */
export const PY_SPACE = PY_SPACE_RANGES.map(([a, b]) => (a === b ? hex4(a) : hex4(a) + '-' + hex4(b))).join('');
const SPACE_END = new RegExp(`[${PY_SPACE}]+$`);
const SPACE_START = new RegExp(`^[${PY_SPACE}]+`);
export const pyStrip = (s: string): string => s.replace(SPACE_START, '').replace(SPACE_END, '');

export const stripSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/** len(str): code points. */
export const pyLen = (s: string): number => Array.from(s).length;

/** s[:n] by code points. */
export const pyHead = (s: string, n: number): string => Array.from(s).slice(0, n).join('');

const SURROGATE = /[\ud800-\udfff]/;

/** Compare strings by code point, as Python does (UTF-16 order differs for astral characters). */
export function cmpStr(a: string, b: string): number {
  if (a === b) return 0;
  if (!SURROGATE.test(a) && !SURROGATE.test(b)) return a < b ? -1 : 1;
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** sorted() of strings. */
export const sortedStrings = (items: Iterable<string>): string[] => [...items].sort(cmpStr);

/** " ".join(items): TypeError for non-strings like CPython. */
export function pyJoin(sep: string, items: unknown): string {
  if (!Array.isArray(items) && !isDict(items) && typeof items !== 'string') throw new TypeError_('can only join an iterable');
  const list = iterate(items);
  return list.map((x, i) => {
    if (typeof x !== 'string') throw new TypeError_(`sequence item ${i}: expected str instance, ${pyTypeName(x)} found`);
    return x;
  }).join(sep);
}

/** Python casefold() approximated: lower-casing plus the common full case foldings. */
export function casefold(s: string): string {
  return s.toLowerCase().replace(/ß/g, 'ss').replace(/ſ/g, 's').replace(/ς/g, 'σ').replace(/ẞ/g, 'ss');
}

// --- iteration, ordering, equality ----------------------------------------------------------

/** list(x) for the iterables the store meets: list, dict (keys) and str (characters). */
export function iterate(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isDict(v)) return Object.keys(v);
  if (typeof v === 'string') return Array.from(v);
  throw new TypeError_(`'${pyTypeName(v)}' object is not iterable`);
}

/** len(x). */
export function lenOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (isDict(v)) return Object.keys(v).length;
  if (typeof v === 'string') return pyLen(v);
  throw new TypeError_(`object of type '${pyTypeName(v)}' has no len()`);
}

/** `x in {set literal of strings}`: unhashable operands raise TypeError. */
export function inStrings(v: unknown, set: ReadonlySet<string>): boolean {
  if (Array.isArray(v) || isDict(v)) throw new TypeError_(`unhashable type: '${pyTypeName(v)}'`);
  return typeof v === 'string' && set.has(v);
}

/** {**v}: TypeError unless v is a dict. */
export function spread(v: unknown): Rec {
  if (!isDict(v)) throw new TypeError_(`'${pyTypeName(v)}' object is not a mapping`);
  return v;
}

const numeric = (v: unknown): number | null =>
  typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : v instanceof PyFloat ? v.value : null;

/** Python == on the JSON model (True == 1 == 1.0). */
export function pyEq(a: unknown, b: unknown): boolean {
  const x = a === undefined ? null : a, y = b === undefined ? null : b;
  const nx = numeric(x), ny = numeric(y);
  if (nx !== null || ny !== null) return nx !== null && ny !== null && nx === ny;
  if (x === null || y === null) return x === y;
  if (typeof x === 'string' || typeof y === 'string') return x === y;
  if (Array.isArray(x) || Array.isArray(y)) {
    return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => pyEq(v, y[i]));
  }
  if (isDict(x) && isDict(y)) {
    const kx = Object.keys(x);
    return kx.length === Object.keys(y).length && kx.every((k) => hasOwn(y, k) && pyEq(x[k], y[k]));
  }
  return false;
}

/** a < b / a >= b ...: numbers and strings compare, anything else is a TypeError like CPython's. */
export function pyCompare(op: '<' | '<=' | '>' | '>=', a: unknown, b: unknown): boolean {
  const x = a === undefined ? null : a, y = b === undefined ? null : b;
  const nx = numeric(x), ny = numeric(y);
  let c: number | null = null;
  if (nx !== null && ny !== null) c = nx < ny ? -1 : nx > ny ? 1 : 0;
  else if (typeof x === 'string' && typeof y === 'string') c = cmpStr(x, y);
  else if (Array.isArray(x) && Array.isArray(y)) c = null;
  if (c === null) {
    throw new TypeError_(`'${op}' not supported between instances of '${pyTypeName(x)}' and '${pyTypeName(y)}'`);
  }
  return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
}

/** dict(x) for the JSON model: a copy of a dict, or the pairs of a list; other values fail like CPython. */
export function pyDict(v: unknown): Rec {
  if (isDict(v)) return { ...v };
  if (typeof v === 'string' || Array.isArray(v)) {
    const out: Rec = {};
    iterate(v).forEach((item, i) => {
      if (typeof item === 'number' || typeof item === 'boolean' || item === null || item instanceof PyFloat) {
        throw new TypeError_(`cannot convert dictionary update sequence element #${i} to a sequence`);
      }
      const pair = iterate(item);
      if (pair.length !== 2) throw new ValueError(`dictionary update sequence element #${i} has length ${pair.length}; 2 is required`);
      if (typeof pair[0] !== 'string') throw new Error('pyDict: non-string keys are outside the JSON model');
      out[pair[0]] = pair[1];
    });
    return out;
  }
  throw new TypeError_(`'${pyTypeName(v)}' object is not iterable`);
}

/** Deep copy of the JSON model (copy.deepcopy); PyFloat is immutable and shared. */
export function clone<T>(v: T): T {
  if (Array.isArray(v)) {
    const out: unknown[] = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = clone(v[i]);
    return out as T;
  }
  if (isDict(v)) {
    const out: Rec = {};
    for (const k in v) {
      if (!hasOwn(v, k)) continue;
      // A JSON key "__proto__" must become an own property, not set the prototype.
      if (k === '__proto__') Object.defineProperty(out, k, { value: clone(v[k]), enumerable: true, writable: true, configurable: true });
      else out[k] = clone(v[k]);
    }
    return out as T;
  }
  return v;
}

/** int(x) for the JSON model (ints, floats, booleans and strings). */
export function toInt(v: unknown): number {
  if (typeof v === 'string') return pyInt(v);
  if (typeof v === 'number') return v;
  if (v instanceof PyFloat) return Math.trunc(v.value);
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${pyTypeName(v)}'`);
}

/** int(str): CPython's accepted spellings (sign, surrounding whitespace, digit-group underscores). */
export function pyInt(s: string): number {
  const t = pyStrip(s);
  if (!/^[+-]?\p{Nd}+(_\p{Nd}+)*$/u.test(t)) throw new ValueError(`invalid literal for int() with base 10: ${pyStrRepr(s)}`);
  let value = 0;
  for (const ch of t) {
    if (ch === '+' || ch === '-' || ch === '_') continue;
    let cp = ch.codePointAt(0)!;
    let digit = 0;
    while (/^\p{Nd}$/u.test(String.fromCodePoint(cp - 1)) && cp > 0) { cp--; digit++; }
    value = value * 10 + (digit % 10);
  }
  return t.startsWith('-') ? -value : value;
}

// --- urllib.parse ---------------------------------------------------------------------------

function unquote(s: string): string {
  if (!s.includes('%')) return s;
  // Percent-escape runs decode as UTF-8 with errors='replace'; other text is kept.
  return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) =>
    new TextDecoder().decode(new Uint8Array(run.slice(1).split('%').map((h) => parseInt(h, 16)))));
}
const unquotePlus = (s: string): string => unquote(s.replace(/\+/g, ' '));

/** urllib.parse.parse_qsl(qs, keep_blank_values=keepBlank). */
export function parseQsl(query: string, keepBlank = false): [string, string][] {
  const pairs: [string, string][] = [];
  if (!query) return pairs;
  for (const part of query.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const name = i < 0 ? part : part.slice(0, i), value = i < 0 ? '' : part.slice(i + 1);
    if (value || keepBlank) pairs.push([unquotePlus(name), unquotePlus(value)]);
  }
  return pairs;
}

/** str.encode(): UTF-8 bytes; lone surrogates raise UnicodeEncodeError (a ValueError) like CPython. */
export function utf8Bytes(s: string): Uint8Array {
  if (/[\ud800-\udfff]/.test(s)) {
    const chars = Array.from(s);
    const lone = (c: string) => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff;
    const start = chars.findIndex(lone);
    if (start >= 0) {
      let end = start;
      while (end + 1 < chars.length && lone(chars[end + 1])) end++;
      const hex = (i: number) => '\\u' + chars[i].charCodeAt(0).toString(16).padStart(4, '0');
      throw new UnicodeEncodeError(start === end
        ? `'utf-8' codec can't encode character '${hex(start)}' in position ${start}: surrogates not allowed`
        : `'utf-8' codec can't encode characters in position ${start}-${end}: surrogates not allowed`);
    }
  }
  return new TextEncoder().encode(s);
}

function quotePlus(s: string): string {
  let out = '';
  for (const byte of utf8Bytes(s)) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.\-~]/.test(ch)) out += ch;
    else if (ch === ' ') out += '+';
    else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** urllib.parse.urlencode(pairs). */
export const urlencode = (pairs: [string, string][]): string =>
  pairs.map(([k, v]) => quotePlus(k) + '=' + quotePlus(v)).join('&');

/** urllib.parse.urlsplit: scheme, netloc, path and query (the fragment is dropped). */
export function urlsplit(input: string): { scheme: string; netloc: string; path: string; query: string } {
  // eslint-disable-next-line no-control-regex
  let url = input.replace(/^[\x00-\x20]+/, '').replace(/[\t\r\n]/g, '');
  let scheme = '', netloc = '', query = '';
  const colon = url.indexOf(':');
  if (colon > 0 && /^[A-Za-z]/.test(url) && /^[A-Za-z0-9+.-]*$/.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    url = url.slice(colon + 1);
  }
  if (url.startsWith('//')) {
    let delim = url.length;
    for (const c of '/?#') {
      const at = url.indexOf(c, 2);
      if (at >= 0) delim = Math.min(delim, at);
    }
    netloc = url.slice(2, delim);
    url = url.slice(delim);
    if ((netloc.includes('[') && !netloc.includes(']')) || (netloc.includes(']') && !netloc.includes('['))) {
      throw new ValueError('Invalid IPv6 URL');
    }
    if (netloc.includes('[') && netloc.includes(']')) {
      const hostAndPort = netloc.slice(netloc.lastIndexOf('@') + 1);
      const open = hostAndPort.indexOf('[');
      const after = hostAndPort.slice(open + 1);
      const port = after.includes(']') ? after.slice(after.indexOf(']') + 1) : '';
      if (open > 0 || (port && !port.startsWith(':'))) throw new ValueError('Invalid IPv6 URL');
    }
  }
  const hash = url.indexOf('#');
  if (hash >= 0) url = url.slice(0, hash);
  const q = url.indexOf('?');
  if (q >= 0) { query = url.slice(q + 1); url = url.slice(0, q); }
  if (netloc && !/^[\x00-\x7f]*$/.test(netloc)) {  // eslint-disable-line no-control-regex
    const n = netloc.replace(/[@:#?]/g, '');
    const folded = n.normalize('NFKC');
    if (n !== folded && /[/?#@:]/.test(folded)) {
      throw new ValueError("netloc '" + netloc + "' contains invalid characters under NFKC normalization");
    }
  }
  return { scheme, netloc, path: url, query };
}
