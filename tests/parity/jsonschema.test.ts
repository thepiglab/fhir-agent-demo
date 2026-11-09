// The Draft-6 validator in src/fhir/jsonschema.ts against ajv (an independent implementation):
// on the corpus' write bodies both must agree whether a resource is valid. Messages and error
// order are checked against CPython in port-fixtures.test.ts; ajv only cross-checks validity.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { beforeAll, describe, expect, it } from 'vitest';
import { pyDumps } from '../../src/fhir/pyjson.ts';
import { pathString, pythonRegExp } from '../../src/fhir/jsonschema.ts';
import { pyRepr } from '../../src/fhir/pyrt.ts';
import { schemaValidator, setEnvData } from '../../src/fhir/envdata.ts';
import { episodes, missingData } from './load.ts';

const ENV = new URL('../../public/data/env/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('fhir.schema.json', ENV), 'utf8')) as { definitions: Record<string, unknown> };

beforeAll(() => {
  setEnvData({ schema, contracts: JSON.parse(readFileSync(new URL('resource_contracts.json', ENV), 'utf8')) });
});

describe('Python repr', () => {
  it('matches repr() for the JSON model', () => {
    expect(pyRepr("it's")).toBe('"it\'s"');
    expect(pyRepr('both \' and "')).toBe('\'both \\\' and "\'');
    expect(pyRepr('tab\tnl\n​é😀')).toBe("'tab\\tnl\\n\\u200bé😀'");
    expect(pyRepr({ a: [1, null, true, false, 'x'], b: {} })).toBe("{'a': [1, None, True, False, 'x'], 'b': {}}");
    expect(pathString(['name', 0, 'given'])).toBe("deque(['name', 0, 'given'])");
    expect(pathString([])).toBe('deque([])');
  });
});

describe('Python regular expressions', () => {
  it('end-of-pattern $ also matches before a trailing newline, and \\s is Unicode whitespace', () => {
    expect(pythonRegExp('^abc$').test('abc\n')).toBe(true);
    expect(pythonRegExp('^abc$').test('abc\n\n')).toBe(false);
    expect(pythonRegExp('^\\S*$').test('a b')).toBe(false);
    expect(pythonRegExp('^[ \\r\\n\\t\\S]+$').test('a b\r\n ')).toBe(false);
    expect(pythonRegExp('^[ \\r\\n\\t\\S]+$').test('a b\r\n')).toBe(true);
  });
});

describe.skipIf(missingData() !== null)('ajv agrees on the corpus write bodies', () => {
  it('valid under ajv exactly when iter_errors finds nothing', () => {
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const compiled = new Map<string, ReturnType<Ajv['compile']>>();
    const check = (resource: unknown): string | null => {
      const type = (resource as { resourceType?: unknown } | null)?.resourceType;
      if (typeof type !== 'string' || !(type in schema.definitions)) return null;
      let validate = compiled.get(type);
      if (!validate) compiled.set(type, validate = ajv.compile({ $ref: `#/definitions/${type}`, definitions: schema.definitions }));
      const plain = JSON.parse(pyDumps(resource)) as unknown;
      const ours = schemaValidator().iterErrors(type, resource).length === 0;
      return validate(plain) === ours ? null : `${type}: ajv ${String(validate(plain))}, ours ${String(ours)}: ${JSON.stringify(plain).slice(0, 200)}`;
    };
    const disagreements: string[] = [];
    let checked = 0;
    for (const episode of episodes()) {
      for (const call of episode.calls) {
        const body = call.args.body as { resourceType?: string; entry?: { resource?: unknown }[] } | null;
        if (!body || typeof body !== 'object') continue;
        const resources = body.resourceType === 'Bundle' ? (body.entry ?? []).map((e) => e.resource) : [body];
        for (const resource of resources) {
          if (resource === undefined) continue;
          checked++;
          const problem = check(resource);
          if (problem) disagreements.push(problem);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(disagreements.slice(0, 5).join('\n'), `${disagreements.length} of ${checked} disagree`).toBe('');
  });
});
