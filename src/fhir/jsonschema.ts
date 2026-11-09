// A Draft-6 JSON Schema validator that reproduces python-jsonschema 4.26.0 (Draft6Validator)
// for the keywords fhir.schema.json uses: $ref, type, properties, additionalProperties, items,
// required, enum, const, pattern and oneOf (the Bundle/contained ResourceList union). It yields the same errors in the same order (schema key
// order; a $ref hides its siblings), with the same message strings, which embed Python repr().
// Keywords of the Draft 6 vocabulary it does not implement make setSchema throw, so a schema
// change cannot silently weaken validation. The schema root is {"definitions": {...}} and
// every validation starts from a "#/definitions/<name>" reference.
import { PyFloat } from './pyjson.ts';
import { PY_SPACE, PY_SPACE_RANGES, PyError, cmpStr, hasOwn, isDict, pyRepr, pyStrRepr, type Rec } from './pyrt.ts';

export interface ValidationError {
  message: string;
  /** The keyword that failed ("type", "required", ...). */
  validator: string;
  validator_value: unknown;
  instance: unknown;
  /** error.path (relative == absolute here): property names and array indexes from the root. */
  path: (string | number)[];
}

/** str(error.path): the repr of a collections.deque, which validate_resource sorts by. */
export function pathString(path: readonly (string | number)[]): string {
  return 'deque([' + path.map(pyRepr).join(', ') + '])';
}

const UNIMPLEMENTED = new Set([
  'additionalItems', 'allOf', 'anyOf', 'contains', 'dependencies', 'exclusiveMaximum', 'exclusiveMinimum',
  'format', 'maxItems', 'maxLength', 'maxProperties', 'maximum', 'minItems', 'minLength', 'minProperties',
  'minimum', 'multipleOf', 'not', 'patternProperties', 'propertyNames', 'uniqueItems',
]);

// --- Python regular expressions -------------------------------------------------------------

/** The whitespace code points as a set (for a class that mixes literals with \S). */
function whitespaceCodePoints(): Set<number> {
  const out = new Set<number>();
  for (const [lo, hi] of PY_SPACE_RANGES) for (let c = lo; c <= hi; c++) out.add(c);
  return out;
}

/** Translate a Python `re` pattern (used with re.search on str) to an equivalent JS RegExp. */
export function pythonRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next === 's') out += `[${PY_SPACE}]`;
      else if (next === 'S') out += `[^${PY_SPACE}]`;
      else if (next === 'd') out += '\\p{Nd}';
      else if (next === 'D') out += '\\P{Nd}';
      else if (next === 'w') out += '[\\p{L}\\p{N}_]';
      else if (next === 'W') out += '[^\\p{L}\\p{N}_]';
      else out += ch + next;
      i += 2;
    } else if (ch === '[') {
      // Copy the class, translating \s; a class that mixes literals with \S is rewritten.
      let j = i + 1;
      let body = '';
      while (j < pattern.length && pattern[j] !== ']') {
        if (pattern[j] === '\\') { body += pattern[j] + pattern[j + 1]; j += 2; } else { body += pattern[j]; j++; }
      }
      if (body.includes('\\S')) {
        if (body.startsWith('^') || /\\[^\\rntSs.\-]/.test(body.replace('\\S', ''))) throw new Error(`unsupported class with \\S: [${body}]`);
        const keep = new Set<number>();
        for (const m of body.replace('\\S', '').matchAll(/\\([rntfv])| /g)) {
          keep.add(m[0] === ' ' ? 0x20 : { r: 13, n: 10, t: 9, f: 12, v: 11 }[m[1] as 'r' | 'n' | 't' | 'f' | 'v']);
        }
        const excluded = [...whitespaceCodePoints()].filter((c) => !keep.has(c));
        out += '[^' + excluded.map((c) => '\\u' + c.toString(16).padStart(4, '0')).join('') + ']';
      } else {
        out += '[' + body.replace(/\\s/g, PY_SPACE).replace(/\\d/g, '\\p{Nd}') + ']';
      }
      i = j + 1;
    } else if (ch === '$') {
      out += '(?=\\n?$)';  // Python's $ also matches before a trailing newline
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return new RegExp(out, 'u');
}

const regexCache = new Map<string, RegExp>();
function search(pattern: string, text: string): boolean {
  let re = regexCache.get(pattern);
  if (!re) regexCache.set(pattern, re = pythonRegExp(pattern));
  return re.test(text);
}

// --- the validator --------------------------------------------------------------------------

function isType(instance: unknown, type: string): boolean {
  switch (type) {
    case 'array': return Array.isArray(instance);
    case 'boolean': return typeof instance === 'boolean';
    case 'integer': return typeof instance === 'number' && Number.isInteger(instance) || instance instanceof PyFloat && Number.isInteger(instance.value);
    case 'null': return instance === null;
    case 'number': return typeof instance === 'number' || instance instanceof PyFloat;
    case 'object': return isDict(instance);
    case 'string': return typeof instance === 'string';
    default: throw new PyError('UnknownType', type);
  }
}

/** jsonschema's `equal`: a string equals only the same string; the rest compare as JSON values. */
function equal(one: unknown, two: unknown): boolean {
  if (typeof one === 'string' || typeof two === 'string') return one === two;
  if (Array.isArray(one) && Array.isArray(two)) return one.length === two.length && one.every((x, i) => equal(x, two[i]));
  if (isDict(one) && isDict(two)) {
    const keys = Object.keys(one);
    return keys.length === Object.keys(two).length && keys.every((k) => hasOwn(two, k) && equal(one[k], two[k]));
  }
  const num = (v: unknown) => (v instanceof PyFloat ? v.value : v);
  return num(one) === num(two);
}

const FOUND = Symbol('first error');

export class Draft6Schema {
  private readonly definitions: Rec;

  constructor(definitions: Rec) {
    this.definitions = definitions;
    for (const node of Object.values(definitions)) this.check(node);
  }

  private check(node: unknown): void {
    if (!isDict(node)) return;
    for (const [keyword, value] of Object.entries(node)) {
      if (UNIMPLEMENTED.has(keyword)) throw new Error(`jsonschema.ts does not implement the keyword ${keyword}`);
      if (keyword === 'properties' && isDict(value)) for (const child of Object.values(value)) this.check(child);
      else if (keyword === 'items') (Array.isArray(value) ? value : [value]).forEach((child) => this.check(child));
      else if (keyword === 'oneOf' && Array.isArray(value)) value.forEach((child) => this.check(child));
      else if (keyword === 'additionalProperties') this.check(value);
    }
  }

  /** All errors of `instance` against #/definitions/<name>, in Draft6Validator.iter_errors order. */
  iterErrors(name: string, instance: unknown): ValidationError[] {
    const out: ValidationError[] = [];
    this.walk(instance, this.resolve(`#/definitions/${name}`), [], (e) => { out.push(e); });
    return out;
  }

  private resolve(ref: string): unknown {
    if (!ref.startsWith('#/')) throw new PyError('Unresolvable', ref);
    let node: unknown = { definitions: this.definitions };
    for (const raw of ref.slice(2).split('/')) {
      const part = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isDict(node) || !hasOwn(node, part)) throw new PyError('Unresolvable', ref);
      node = node[part];
    }
    return node;
  }

  /** jsonschema's is_valid: stops at the first error. */
  private isValid(instance: unknown, schema: unknown): boolean {
    try {
      this.walk(instance, schema, [], () => { throw FOUND; });
      return true;
    } catch (error) {
      if (error === FOUND) return false;
      throw error;
    }
  }

  private walk(instance: unknown, schema: unknown, path: (string | number)[], out: (error: ValidationError) => void): void {
    if (schema === true) return;
    if (schema === false) {
      out({ message: `False schema does not allow ${pyRepr(instance)}`, validator: 'false', validator_value: null, instance, path: path.slice() });
      return;
    }
    if (!isDict(schema)) throw new PyError('SchemaError', `Not a schema: ${pyRepr(schema)}`);
    const add = (keyword: string, message: string) =>
      out({ message, validator: keyword, validator_value: schema[keyword], instance, path: path.slice() });
    // Draft 6: when $ref is present its siblings are ignored.
    const ref = schema['$ref'];
    if (ref !== undefined && ref !== null) {
      this.walk(instance, this.resolve(ref as string), path, out);
      return;
    }
    for (const keyword of Object.keys(schema)) {
      const value = schema[keyword];
      switch (keyword) {
        case 'type': {
          const types = typeof value === 'string' ? [value] : (value as string[]);
          if (!types.some((t) => isType(instance, t))) {
            add('type', `${pyRepr(instance)} is not of type ${types.map(pyStrRepr).join(', ')}`);
          }
          break;
        }
        case 'properties': {
          if (!isDict(instance)) break;
          for (const [property, subschema] of Object.entries(value as Rec)) {
            if (hasOwn(instance, property)) {
              path.push(property);
              this.walk(instance[property], subschema, path, out);
              path.pop();
            }
          }
          break;
        }
        case 'additionalProperties': {
          if (!isDict(instance)) break;
          const known = isDict(schema.properties) ? schema.properties : {};
          const extras = Object.keys(instance).filter((p) => !hasOwn(known, p));
          if (isDict(value)) {
            for (const extra of extras) {
              path.push(extra);
              this.walk(instance[extra], value, path, out);
              path.pop();
            }
          } else if (!value && extras.length) {
            const sorted = extras.sort(cmpStr);
            add('additionalProperties',
              `Additional properties are not allowed (${sorted.map(pyStrRepr).join(', ')} ${sorted.length === 1 ? 'was' : 'were'} unexpected)`);
          }
          break;
        }
        case 'items': {
          if (!Array.isArray(instance)) break;
          if (Array.isArray(value)) {
            const n = Math.min(instance.length, value.length);
            for (let index = 0; index < n; index++) {
              path.push(index);
              this.walk(instance[index], value[index], path, out);
              path.pop();
            }
          } else {
            for (let index = 0; index < instance.length; index++) {
              path.push(index);
              this.walk(instance[index], value, path, out);
              path.pop();
            }
          }
          break;
        }
        case 'required': {
          if (!isDict(instance)) break;
          for (const property of value as string[]) {
            if (!hasOwn(instance, property)) add('required', `${pyStrRepr(property)} is a required property`);
          }
          break;
        }
        case 'enum': {
          const enums = value as unknown[];
          if (enums.every((each) => !equal(each, instance))) add('enum', `${pyRepr(instance)} is not one of ${pyRepr(enums)}`);
          break;
        }
        case 'const': {
          if (!equal(instance, value)) add('const', `${pyRepr(value)} was expected`);
          break;
        }
        case 'oneOf': {
          const alternatives = value as unknown[];
          let firstValid = -1;
          for (let index = 0; index < alternatives.length; index++) {
            if (this.isValid(instance, alternatives[index])) { firstValid = index; break; }
          }
          if (firstValid < 0) {
            add('oneOf', `${pyRepr(instance)} is not valid under any of the given schemas`);
            break;
          }
          const moreValid = alternatives.slice(firstValid + 1).filter((each) => this.isValid(instance, each));
          if (moreValid.length) {
            moreValid.push(alternatives[firstValid]);
            add('oneOf', `${pyRepr(instance)} is valid under each of ${moreValid.map(pyRepr).join(', ')}`);
          }
          break;
        }
        case 'pattern': {
          if (typeof instance === 'string' && !search(value as string, instance)) {
            add('pattern', `${pyRepr(instance)} does not match ${pyRepr(value)}`);
          }
          break;
        }
        default:
          if (UNIMPLEMENTED.has(keyword)) throw new Error(`jsonschema.ts does not implement the keyword ${keyword}`);
          // description, id, definitions, ...: annotations, not validators.
      }
    }
  }
}
