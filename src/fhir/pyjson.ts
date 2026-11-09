// Python-compatible JSON for the browser: the model was trained on tool responses written by
// Python's json.dumps(..., ensure_ascii=False), so responses must be serialized the same way
// (", " and ": " separators, floats that keep their ".0"). JSON numbers written with a "."
// or an exponent parse into PyFloat so they round-trip.

type Dict = { [key: string]: unknown };

export class PyFloat {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf() { return this.value; }
  toString() { return pyFloatRepr(this.value); }
  /** JSON.stringify (the page's /api responses, the ask stream) sees a plain number; pyDumps keeps the Python form. */
  toJSON() { return this.value; }
}

function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  // Python repr: shortest round-trip digits; exponent form when exp < -4 or exp >= 16.
  const [mant, expStr] = x.toExponential().split('e');
  const exp = parseInt(expStr, 10);
  if (exp < -4 || exp >= 16) {
    const m = mant.includes('.') ? mant : mant;
    const e = Math.abs(exp) < 10 ? '0' + Math.abs(exp) : String(Math.abs(exp));
    return m + 'e' + (exp < 0 ? '-' : '+') + e;
  }
  const s = String(x);
  if (s.includes('e')) {  // JS uses exponents earlier than Python on the small side
    const digits = mant.replace('-', '').replace('.', '');
    const sign = x < 0 ? '-' : '';
    return sign + '0.' + '0'.repeat(-exp - 1) + digits;
  }
  return s.includes('.') ? s : s + '.0';
}

/** JSON.parse reviver context (ES2025 JSON.parse source text access); absent on old engines. */
type ReviverContext = { source?: string };

/** JSON.parse with floats kept as PyFloat. The caller names the expected shape (unchecked). */
export function pyParse<T = unknown>(text: string): T {
  return JSON.parse(text, (_key: string, value: unknown, context?: ReviverContext) => {
    if (typeof value === 'number' && context && /[.eE]/.test(context.source as string)) {
      return new PyFloat(value);
    }
    return value;
  });
}

function pyString(s: string): string {
  // json.dumps with ensure_ascii=False escapes ", \\ and C0 controls only.
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

export function pyDumps(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value instanceof PyFloat) return pyFloatRepr(value.value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : pyFloatRepr(value);
  if (typeof value === 'string') return pyString(value);
  if (Array.isArray(value)) return '[' + value.map(pyDumps).join(', ') + ']';
  return '{' + Object.entries(value as Dict).map(([k, v]) => pyString(k) + ': ' + pyDumps(v)).join(', ') + '}';
}
