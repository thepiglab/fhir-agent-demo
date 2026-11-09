// The browser's FHIR store. The implementation is the TypeScript port of the canonical Python
// (store.ts, validation.ts, contracts.ts, protocol.ts; gated by tests/parity/store.test.ts);
// this module keeps the export names the app already imports. Writes and schema validation
// need loadEnvData() (or setEnvData) to have run once; reads work without it.
import type { FhirResource } from '../types.ts';
import { FhirStore as PortedStore } from './store.ts';
import type { FhirResult as PortedResult } from './store.ts';
import type { Rec } from './pyrt.ts';

export { PyFloat, pyParse, pyDumps } from './pyjson.ts';
export { patientRef, ref, references } from './store.ts';
export { loadEnvData, setEnvData } from './envdata.ts';
export type { AuditEntry, StoreEvent } from './store.ts';

/** A JSON object as pyParse yields it (values may be PyFloat). */
export type Dict = Rec;

/** One search Bundle, as _search builds it. */
export type BundleEntry = { fullUrl: string; resource: FhirResource; search: { mode: 'match' | 'include' } };
export type Bundle = {
  resourceType: 'Bundle';
  type: 'searchset';
  total: number;
  entry: BundleEntry[];
  link?: { relation: string; url: string }[];
};

/** FhirStore.request's result: {status, headers, body}, as store.py returns it. */
export type FhirResult = PortedResult;

/** fhir_request's tool arguments; the values come straight from the model. */
export type FhirRequestArgs = { method?: unknown; path?: unknown; body?: unknown; if_match?: unknown; if_none_exist?: unknown };

const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** The interface v0.5 store over a chart: read-only unless built through episodeStore. */
export class FhirStore extends PortedStore {
  constructor(resources: FhirResource[], { maxCalls = 40 }: { maxCalls?: number } = {}) {
    super(resources, { interface: 'v0.5', max_calls: maxCalls });
  }

  /** The tool's text output, exactly as fhir_request_object returns it. */
  fhirRequest(args: FhirRequestArgs): string {
    return this.fhirRequestObject({
      method: text(args.method), path: text(args.path), body: args.body,
      if_match: text(args.if_match), if_none_exist: text(args.if_none_exist),
    });
  }
}
