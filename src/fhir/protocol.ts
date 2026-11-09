// Port of fhir_query_rl/protocol.py at bf9db15 (sha256 83e8a31cd8c40b6e41d6ca6eb6b8bd005824f56c3179c4f9e0654054e730115e)
//
// Explicit JSON action transport; never infer or repair executable commands. parse_object is
// json.loads with CPython's decoder semantics (error messages included), duplicate keys and
// the non-JSON constants NaN/Infinity rejected; floats come back as PyFloat.
import { PyFloat } from './pyjson.ts';
import { PY_SPACE, TypeError_, ValueError, pyLen, type Rec } from './pyrt.ts';

/** Tool-interface contracts, oldest first; each keeps every earlier version's fixes. */
export const INTERFACES = ['v0.4', 'v0.5', 'v0.6'] as const;

function indexOfInterface(interfaceName: string): number {
  const at = (INTERFACES as readonly string[]).indexOf(interfaceName);
  if (at < 0) throw new ValueError(`tuple.index(x): x not in tuple`);
  return at;
}

/** True when the interface includes the changes introduced by `version`. */
export function since(interfaceName: string, version: string): boolean {
  return indexOfInterface(interfaceName) >= indexOfInterface(version);
}

/** json.JSONDecodeError: message, "line L column C (char N)". */
export class JSONDecodeError extends ValueError {
  readonly pos: number;
  constructor(msg: string, doc: string, pos: number) {
    const before = doc.slice(0, pos);
    const char = pyLen(before);
    const lineno = before.split('\n').length;
    const colno = lineno === 1 ? char + 1 : pyLen(before.slice(before.lastIndexOf('\n') + 1)) + 1;
    super(`${msg}: line ${lineno} column ${colno} (char ${char})`);
    this.pos = char;
    Object.defineProperty(this, 'kind', { value: 'JSONDecodeError' });
    this.name = 'JSONDecodeError';
  }
}

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

class Decoder {
  private readonly s: string;
  constructor(text: string) { this.s = text; }

  private skipWs(i: number): number {
    while (i < this.s.length && isWs(this.s[i])) i++;
    return i;
  }

  private fail(msg: string, pos: number): never { throw new JSONDecodeError(msg, this.s, pos); }

  /** json.loads(text, object_pairs_hook=<reject duplicates>, parse_constant=<reject>). */
  parse(): unknown {
    const s = this.s;
    if (s.startsWith('﻿')) this.fail('Unexpected UTF-8 BOM (decode using utf-8-sig)', 0);
    const start = this.skipWs(0);
    const [value, end] = this.value(start);
    const tail = this.skipWs(end);
    if (tail !== s.length) this.fail('Extra data', tail);
    return value;
  }

  private value(i: number): [unknown, number] {
    const s = this.s;
    const c = s[i];
    if (c === '"') return this.string(i + 1);
    if (c === '{') return this.object(i + 1);
    if (c === '[') return this.array(i + 1);
    if (c === 'n' && s.startsWith('null', i)) return [null, i + 4];
    if (c === 't' && s.startsWith('true', i)) return [true, i + 4];
    if (c === 'f' && s.startsWith('false', i)) return [false, i + 5];
    if (c === 'N' && s.startsWith('NaN', i)) throw new ValueError('Non-JSON numeric constant: NaN');
    if (c === 'I' && s.startsWith('Infinity', i)) throw new ValueError('Non-JSON numeric constant: Infinity');
    if (c === '-' && s.startsWith('-Infinity', i)) throw new ValueError('Non-JSON numeric constant: -Infinity');
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(s);
    if (m === null) this.fail('Expecting value', i);
    const text = m[0];
    return [m[1] !== undefined || m[2] !== undefined ? new PyFloat(Number(text)) : Number(text) + 0, i + text.length];
  }

  private string(i: number): [string, number] {
    const s = this.s;
    const begin = i - 1;
    let out = '';
    for (;;) {
      if (i >= s.length) this.fail('Unterminated string starting at', begin);
      const c = s[i];
      if (c === '"') return [out, i + 1];
      if (c === '\\') {
        i++;
        if (i >= s.length) this.fail('Unterminated string starting at', begin);
        const e = s[i];
        if (e === 'u') {
          const hex = s.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('Invalid \\uXXXX escape', i);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
        } else if (Object.prototype.hasOwnProperty.call(ESCAPES, e)) {
          out += ESCAPES[e];
          i++;
        } else this.fail('Invalid \\escape', i - 1);
      } else {
        if (c < ' ') this.fail('Invalid control character at', i);
        out += c;
        i++;
      }
    }
  }

  private object(start: number): [Rec, number] {
    const s = this.s;
    const out: Rec = {};
    let i = this.skipWs(start);
    if (s[i] === '}') return [out, i + 1];
    for (;;) {
      if (s[i] !== '"') this.fail('Expecting property name enclosed in double quotes', i);
      const [key, afterKey] = this.string(i + 1);
      i = this.skipWs(afterKey);
      if (s[i] !== ':') this.fail("Expecting ':' delimiter", i);
      i = this.skipWs(i + 1);
      const [value, afterValue] = this.value(i);
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        // _unique_object runs when the object closes: later syntax errors win.
        this.rest(afterValue);
        throw new ValueError(`Duplicate JSON key: ${key}`);
      }
      Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
      i = this.skipWs(afterValue);
      if (s[i] === '}') return [out, i + 1];
      if (s[i] !== ',') this.fail("Expecting ',' delimiter", i);
      const comma = i;
      i = this.skipWs(i + 1);
      if (s[i] === '}') this.fail('Illegal trailing comma before end of object', comma);
    }
  }

  /** Keep parsing an object after a duplicate key so syntax errors take precedence. */
  private rest(from: number): void {
    const s = this.s;
    let i = this.skipWs(from);
    while (s[i] !== '}') {
      if (s[i] !== ',') this.fail("Expecting ',' delimiter", i);
      const comma = i;
      i = this.skipWs(i + 1);
      if (s[i] === '}') this.fail('Illegal trailing comma before end of object', comma);
      if (s[i] !== '"') this.fail('Expecting property name enclosed in double quotes', i);
      const [, afterKey] = this.string(i + 1);
      i = this.skipWs(afterKey);
      if (s[i] !== ':') this.fail("Expecting ':' delimiter", i);
      const [, afterValue] = this.value(this.skipWs(i + 1));
      i = this.skipWs(afterValue);
    }
  }

  private array(start: number): [unknown[], number] {
    const s = this.s;
    const out: unknown[] = [];
    let i = this.skipWs(start);
    if (s[i] === ']') return [out, i + 1];
    for (;;) {
      const [value, after] = this.value(i);
      out.push(value);
      i = this.skipWs(after);
      if (s[i] === ']') return [out, i + 1];
      if (s[i] !== ',') this.fail("Expecting ',' delimiter", i);
      const comma = i;
      i = this.skipWs(i + 1);
      if (s[i] === ']') this.fail('Illegal trailing comma before end of array', comma);
    }
  }
}

/** json.loads for the JSON model (floats as PyFloat), with parse_object's two hooks. */
export function loadsStrict(text: string): unknown {
  return new Decoder(text).parse();
}

const FENCE = new RegExp(`^[${PY_SPACE}]*\`\`\`(?:json)?[${PY_SPACE}]*\\n([\\s\\S]*?)\\n\`\`\`[${PY_SPACE}]*$`);

export function parse_object(text: unknown, allow_fence = false): Rec {
  if (typeof text !== 'string' || pyLen(text) > 65536) throw new ValueError('Expected one JSON object, at most 65536 characters');
  let body = text;
  if (allow_fence) {
    const match = FENCE.exec(text);
    if (match) body = match[1];
  }
  const result = loadsStrict(body);
  if (result === null || typeof result !== 'object' || Array.isArray(result) || result instanceof PyFloat) {
    throw new ValueError('Expected one JSON object');
  }
  return result as Rec;
}

export function is_final(text: unknown, allow_fence = false): boolean {
  try {
    const keys = Object.keys(parse_object(text, allow_fence));
    return keys.length === 2 && keys.includes('answer') && keys.includes('evidence');
  } catch (error) {
    if (error instanceof ValueError || error instanceof TypeError_) return false;
    throw error;
  }
}

export const ACTION_INSTRUCTIONS = `
Use the JSON action interface. Native function calling is disabled in this profile.
Each assistant turn must be exactly ONE JSON object, without explanation or code
fences. To invoke a tool, use {"tool":"TOOL_NAME","args":{...}}. Supply argument
values, not function definitions or JSON schemas. The next user message contains
the tool observation. Only explicitly invoked, validated actions are executed.
For a final answer use {"answer":{...},"evidence":["Type/id",...]}, as requested.
Only cite the resources needed to support the requested fields or change.
Example action (replace example values with the caller's actual information):
{"tool":"fhir_request","args":{"method":"GET","path":"Patient?identifier=https://fhir-workflows.example/mrn|EXAMPLE-MRN&_count=5","body_json":"","headers_json":""}}
`;
