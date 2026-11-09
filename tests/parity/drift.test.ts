// Drift guard for the TypeScript port of the Python FHIR environment.
//
// source-manifest.json (written with the golden corpus) records the commit and sha256 of every
// Python file the port follows. This fails when:
//  - a ported TS module does not name, in its header, the sha256 of the Python file it ports;
//  - the JSON data the browser ships (fhir.schema.json, resource_contracts.json) differs from
//    the source;
//  - the Python source has changed since the port (checked when FHIR_CANONICAL_SOURCE names a
//    checkout of the repo, e.g. the harness-suite branch).
// Re-port, then regenerate the corpus (scripts/web_demo/make_parity_corpus.py) to clear it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HERE = new URL('./', import.meta.url);
const SRC = new URL('../../src/fhir/', import.meta.url);
const ENV_DATA = new URL('../../public/data/env/', import.meta.url);
// A checkout of the Python at the pinned commit; the source-unchanged checks run when it is set.
const source = process.env.FHIR_CANONICAL_SOURCE || '/nonexistent';

interface Manifest { commit: string; package: string; files: Record<string, string> }
const manifest = JSON.parse(readFileSync(new URL('source-manifest.json', HERE), 'utf8')) as Manifest;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** Python module -> the TS modules that port (parts of) it. */
const PORTS: Record<string, string[]> = {
  'store.py': ['store.ts'],
  'validation.py': ['validation.ts'],
  'resource_contracts.py': ['contracts.ts'],
  'scoring.py': ['scoring.ts'],
  'protocol.py': ['protocol.ts'],
  // search_behavior (scoring.ts) and lexical_terms / query_features (store.ts)
  'metrics.py': ['scoring.ts', 'store.ts'],
};
/** Data files the browser ships verbatim. */
const DATA: Record<string, string> = {
  'schemas/fhir.schema.json': 'fhir.schema.json',
  'resource_contracts.json': 'resource_contracts.json',
};

describe('port drift', () => {
  for (const [python, modules] of Object.entries(PORTS)) for (const ts of modules) {
    it(`${ts} names the ported ${python} (${manifest.files[python].slice(0, 12)})`, () => {
      const file = new URL(ts, SRC);
      expect(existsSync(file), `${ts} missing`).toBe(true);
      const head = readFileSync(file, 'utf8').split('\n').slice(0, 15).join('\n');
      expect(head, `${ts}'s header must cite ${python}'s sha256 from source-manifest.json`).toContain(manifest.files[python]);
    });
  }

  for (const [python, shipped] of Object.entries(DATA)) {
    it(`public/data/env/${shipped} is ${python} at ${manifest.commit.slice(0, 7)}`, () => {
      expect(sha256(readFileSync(new URL(shipped, ENV_DATA)))).toBe(manifest.files[python]);
    });
  }

  const pkg = `${source}/${manifest.package}`;
  it.skipIf(!existsSync(pkg))(`the Python source is unchanged since the port (${pkg})`, () => {
    const changed = Object.entries(manifest.files)
      .filter(([name, digest]) => sha256(readFileSync(`${pkg}/${name}`)) !== digest)
      .map(([name]) => name);
    expect(changed, `changed since ${manifest.commit.slice(0, 7)}: re-port these and regenerate the corpus`).toEqual([]);
  });
});

// Harness X16 (fhir_suite_harness at the commit in x16-corpus-info.json): the same rules.
const X16_INFO = new URL('x16-corpus-info.json', HERE);
const X16_PORTS: Record<string, string[]> = {
  'profiles/context1.py': ['context1.ts'],
  'core.py': ['context1.ts', 'tools.ts'],
  'exposure.py': ['exposure.ts'],
  'profiles/__init__.py': ['context1.ts'],
};
describe.skipIf(!existsSync(X16_INFO))('X16 harness port drift', () => {
  const info = existsSync(X16_INFO) ? JSON.parse(readFileSync(X16_INFO, 'utf8')) as { harness: Manifest } : null;
  if (!info) return;
  const files = info.harness.files;
  for (const [python, modules] of Object.entries(X16_PORTS)) for (const ts of modules) {
    it(`${ts} names the ported ${python} (${files[python]!.slice(0, 12)})`, () => {
      const head = readFileSync(new URL(ts, SRC), 'utf8').split('\n').slice(0, 15).join('\n');
      expect(head, `${ts}'s header must cite ${python}'s sha256 from x16-corpus-info.json`).toContain(files[python]);
    });
  }
  const pkg = `${source}/${info.harness.package}`;
  it.skipIf(!existsSync(pkg))(`the harness source is unchanged since the port (${pkg})`, () => {
    const changed = Object.entries(files).filter(([name, digest]) => sha256(readFileSync(`${pkg}/${name}`)) !== digest).map(([name]) => name);
    expect(changed, `changed since ${info.harness.commit.slice(0, 7)}: re-port these and regenerate x16-corpus`).toEqual([]);
  });
});

// Harness X16v2 (x16v2-corpus-info.json) and the tokenizer data its counts use.
const X16V2_INFO = new URL('x16v2-corpus-info.json', HERE);
describe.skipIf(!existsSync(X16V2_INFO))('X16v2 harness port drift', () => {
  const info = existsSync(X16V2_INFO) ? JSON.parse(readFileSync(X16V2_INFO, 'utf8')) as { harness: Manifest } : null;
  if (!info) return;
  const files = info.harness.files;
  const ports: Record<string, string> = { 'profiles/context1_v2.py': 'context1_v2.ts', 'profiles/__init__.py': 'context1_v2.ts', 'profiles/context1.py': 'context1.ts', 'exposure.py': 'exposure.ts' };
  for (const [python, ts] of Object.entries(ports)) {
    it(`${ts} names the ported ${python} at ${info.harness.commit.slice(0, 7)} (${files[python]!.slice(0, 12)})`, () => {
      const head = readFileSync(new URL(ts, SRC), 'utf8').split('\n').slice(0, 15).join('\n');
      expect(head).toContain(files[python]);
    });
  }
  it('tokenizer.ts names the tokenizer.json its data comes from', () => {
    const source = JSON.parse(readFileSync(new URL('../../public/data/tokenizer/source.json', import.meta.url), 'utf8')) as { sha256: string };
    const head = readFileSync(new URL('tokenizer.ts', SRC), 'utf8').split('\n').slice(0, 6).join('\n');
    expect(head).toContain(source.sha256.slice(0, 16));
  });
});
