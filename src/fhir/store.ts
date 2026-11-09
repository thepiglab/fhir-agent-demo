// Port of fhir_query_rl/store.py at bf9db15 (sha256 ecc563c96b0ff0f307418444881e5cc775560c671dca31bcd13ccd62a83751da)
// Also ports lexical_terms, filter_terms and query_features from fhir_query_rl/metrics.py at bf9db15 (sha256 b8c8078554336b3541bbc96e0b3901e9aac1fb751b81f5b01ddf58dc135b5e70)
//
// Deterministic, bounded REST subset with isolated state, ETags and audits. Public fields keep
// Python's names (snake_case) because the scorer port reads them: `resources` and `initial` are
// Maps in Python-dict order, `deleted`/`seen`/`observed_terms` Sets, `audit`/`events` arrays of
// the same dicts. Responses are byte-identical to Python's, including error diagnostics.
//
// Differences from the Python module: snapshot()/from_snapshot() (the native MCP state channel)
// are not ported. Exceptions Python leaves uncaught in request() (AttributeError and the like)
// are thrown as PyError so callers see them, as the corpus's `raised` episodes require.
import { clone as deepcopy, AttributeError, IndexError, KeyError, TypeError_, ValueError, cmpStr, hasOwn, inStrings, isDict, iterate,
  lenOf, parseQsl, pyDumpsAscii, pyEq, pyHead, pyInt, pyJoin, pyStr, pyTypeName, sortedStrings, stripSlashes, sub, subscript,
  casefold, pyDict, toInt, truthy, urlencode, urlsplit, utf8Bytes, type Rec } from './pyrt.ts';
import { pyDumps } from './pyjson.ts';
import { since } from './protocol.ts';
import { coerce_typed_strings, patientRef, pyGet, ref, references, validate_graph, validate_resource } from './validation.ts';
import { validate_contracts } from './contracts.ts';

export { setEnvData } from './envdata.ts';
export { patientRef, ref, references };
export { PyFloat, pyDumps, pyParse } from './pyjson.ts';

// --- constants ------------------------------------------------------------------------------

const BASE_PARAMS: [string, string[]][] = [
  ['Patient', ['identifier', 'name', 'birthdate', 'gender']],
  ['Encounter', ['patient', 'date', 'status']],
  ['Condition', ['patient', 'code', 'clinical-status']],
  ['AllergyIntolerance', ['patient', 'code', 'clinical-status']],
  ['MedicationStatement', ['patient', 'status', 'code']],
  ['MedicationRequest', ['patient', 'status', 'code']],
  ['Observation', ['patient', 'code', 'date', 'status', 'encounter']],
  ['DiagnosticReport', ['patient', 'code', 'date', 'status', 'based-on']],
  ['ServiceRequest', ['patient', 'code', 'status', 'identifier']],
  ['Specimen', ['patient', 'identifier', 'status']],
  ['Procedure', ['patient', 'code', 'status', 'date']],
  ['Coverage', ['patient', 'status', 'identifier']],
  ['Communication', ['patient', 'status', 'based-on', 'identifier', 'sent']],
  ['Task', ['patient', 'status', 'focus', 'identifier']],
  ['Appointment', ['patient', 'status', 'date']],
  ['CarePlan', ['patient', 'status']],
  ['Goal', ['patient', 'lifecycle-status']],
  ['Questionnaire', ['identifier', 'status']],
  ['QuestionnaireResponse', ['patient', 'status']],
  ['DocumentReference', ['patient', 'type', 'status']],
  ['RelatedPerson', ['patient', 'identifier']],
  ['Organization', ['identifier', 'name']],
  ['Practitioner', ['identifier', 'name']],
  ['PractitionerRole', ['practitioner', 'organization']],
  ['Location', ['identifier', 'name']],
  ['Provenance', ['target']],
  ['EpisodeOfCare', ['patient', 'status', 'date']],
  ['CareTeam', ['patient', 'status']],
  ['List', ['patient', 'status', 'code']],
  ['Device', ['patient', 'status']],
  ['Consent', ['patient', 'status']],
  ['Composition', ['patient', 'status', 'type', 'date']],
  ['MedicationDispense', ['patient', 'status', 'code']],
];
const MORE_PARAMS: [string, string[]][] = [
  ['Schedule', ['identifier', 'actor', 'active']],
  ['Slot', ['identifier', 'schedule', 'status', 'start']],
  ['ImagingStudy', ['identifier', 'patient', 'status', 'basedon', 'started']],
  ['Immunization', ['identifier', 'patient', 'status', 'vaccine-code', 'date']],
  ['Medication', ['identifier', 'status', 'code']],
  ['MedicationAdministration', ['identifier', 'patient', 'status', 'code', 'request', 'effective-time']],
  ['CoverageEligibilityRequest', ['identifier', 'patient', 'status']],
  ['CoverageEligibilityResponse', ['identifier', 'patient', 'status', 'request']],
  ['Account', ['identifier', 'patient', 'status']],
  ['ChargeItem', ['identifier', 'patient', 'code', 'context']],
  ['Claim', ['identifier', 'patient', 'status']],
  ['DeviceRequest', ['identifier', 'patient', 'status', 'code', 'authored-on']],
  ['DeviceUseStatement', ['identifier', 'patient', 'device', 'status']],
  ['SupplyDelivery', ['identifier', 'patient', 'status']],
  ['NutritionOrder', ['identifier', 'patient', 'status', 'date']],
  ['CommunicationRequest', ['identifier', 'patient', 'status', 'authored']],
  ['Flag', ['identifier', 'patient', 'status']],
  ['HealthcareService', ['identifier', 'organization', 'name', 'active']],
  ['DocumentManifest', ['identifier', 'patient', 'status']],
  ['DetectedIssue', ['identifier', 'patient', 'status', 'code']],
  ['AppointmentResponse', ['identifier', 'appointment', 'actor', 'part-status']],
];
/** Resource type -> supported search parameters, in Python's dict order. */
export const PARAMS = new Map<string, Set<string>>(BASE_PARAMS.map(([kind, names]) => [kind, new Set(names)]));
for (const [kind, names] of PARAMS) if (kind !== 'Provenance') names.add('identifier');
for (const [kind, names] of MORE_PARAMS) PARAMS.set(kind, new Set(names));
/** v0.6 additions: US Core requires patient+category searches on Observation. */
const PARAMS_V06 = new Map<string, Set<string>>([['Observation', new Set(['category'])]]);
const COMMON = new Set(['_id', '_tag', '_count', '_sort', '_page', '_include']);
const COMMON_SKIPPED = new Set(['_count', '_sort', '_page', '_include']);  // COMMON - {"_id", "_tag"}
const INCLUDES: Record<string, string> = {
  'DiagnosticReport:result': 'result',
  'DiagnosticReport:based-on': 'basedOn',
  'ServiceRequest:subject': 'subject',
  'Task:focus': 'focus',
  'Coverage:payor': 'payor',
  'Appointment:slot': 'slot',
  'Slot:schedule': 'schedule',
  'DiagnosticReport:imaging-study': 'imagingStudy',
  'MedicationRequest:medication': 'medicationReference',
  'MedicationAdministration:request': 'request',
  'CoverageEligibilityResponse:request': 'request',
  'DeviceUseStatement:device': 'device',
  'Observation:has-member': 'hasMember',
  'Observation:specimen': 'specimen',
  'Observation:based-on': 'basedOn',
  'Specimen:request': 'request',
  'List:item': 'entry',
  'DocumentManifest:content': 'content',
  'AppointmentResponse:appointment': 'appointment',
};
const CODE_FIELDS: Record<string, string> = { 'clinical-status': 'clinicalStatus', code: 'code', type: 'type' };
const REF_FIELDS: Record<string, string> = {
  'based-on': 'basedOn', focus: 'focus', target: 'target', encounter: 'encounter', practitioner: 'practitioner',
  organization: 'organization', schedule: 'schedule', actor: 'actor', request: 'request', basedon: 'basedOn',
  device: 'device', context: 'context', appointment: 'appointment',
};
const OTHER_FIELDS: Record<string, string> = { 'lifecycle-status': 'lifecycleStatus', 'vaccine-code': 'vaccineCode', 'part-status': 'participantStatus' };
const DATE_PARAMS = new Set(['date', 'start', 'started', 'effective-time', 'authored-on', 'authored', 'sent']);
const METADATA_DATE_PARAMS = new Set(['date', 'birthdate', 'start', 'started', 'authored', 'authored-on', 'effective-time', 'sent']);
const DATE_FIELDS = [
  'effectiveDateTime', 'performedDateTime', 'issued', 'authoredOn', 'start', 'date', 'dateTime', 'sent', 'recorded',
  'whenHandedOver', 'occurrenceDateTime', 'started',
];
const MEDICATION_CODE_TYPES = new Set(['MedicationStatement', 'MedicationRequest', 'MedicationAdministration', 'MedicationDispense', 'DeviceRequest']);
const WRITE_VERBS = new Set(['POST', 'PUT', 'DELETE']);

// --- helpers --------------------------------------------------------------------------------

/** meta for an update: what the client sent, plus the stored tags, security labels and profiles it did not repeat. */
function carryMeta(stored: unknown, sent: unknown): Rec {
  const meta = pyDict(sent);
  for (const key of ['tag', 'security', 'profile']) {
    const kept: unknown[] = [...(truthy(pyGet(sent, key)) ? iterate(pyGet(sent, key)) : [])];
    // The comprehension filters against `kept` before extending it: duplicates inside stored all survive.
    const extra = (truthy(pyGet(stored, key)) ? iterate(pyGet(stored, key)) : []).filter((x) => !kept.some((k) => pyEq(k, x)));
    kept.push(...extra);
    if (kept.length) meta[key] = kept;
  }
  return meta;
}

function valuesAt(resource: Rec, key: string): unknown[] {
  const value = pyGet(resource, key);
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Does a stored value match a token search value? Exported: the scorer uses the same rule. */
export function token_match(value: unknown, needle: string): boolean {
  if (typeof value === 'boolean') return pyStr(value).toLowerCase() === needle;
  if (typeof value === 'string') return value === needle;
  if (!isDict(value)) return false;
  if (hasOwn(value, 'coding')) return iterate(value.coding).some((c) => token_match(c, needle));
  const code = pyStr(hasOwn(value, 'code') ? value.code : hasOwn(value, 'value') ? value.value : '');
  if (needle.includes('|')) {
    const at = needle.indexOf('|');
    const system = needle.slice(0, at), expected = needle.slice(at + 1);
    return (!system || value.system === system) && code === expected;
  }
  return code === needle;
}

export function resource_date(resource: Rec): string {
  for (const field of DATE_FIELDS) if (truthy(pyGet(resource, field))) return pyStr(resource[field]);
  return pyStr(pyGet(pyGet(resource, 'period', {}), 'start', ''));
}

const DATE_PREDICATE = /^(eq|ne|gt|ge|lt|le)?(\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2})$/u;

export function date_match(value: unknown, search: string): boolean {
  const match = DATE_PREDICATE.exec(search);
  if (!match) throw new ValueError('Only day-precision date predicates are supported');
  const op = match[1] || 'eq', target = match[2];
  if (typeof value !== 'string') throw new TypeError_(`'${pyTypeName(value)}' object is not subscriptable`);
  const day = pyHead(value, 10);
  if (!day) return false;
  const c = cmpStr(day, target);
  return { eq: c === 0, ne: c !== 0, gt: c > 0, ge: c >= 0, lt: c < 0, le: c <= 0 }[op as 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'];
}

export class FhirError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'FhirError';
  }
}

/** The exceptions FhirStore.request turns into an OperationOutcome (Python's except clause). */
function isCaught(error: unknown): error is FhirError | ValueError | KeyError | TypeError_ | IndexError {
  return error instanceof FhirError || error instanceof ValueError || error instanceof KeyError ||
    error instanceof TypeError_ || error instanceof IndexError;
}

// --- events ---------------------------------------------------------------------------------

/** metrics.lexical_terms: case-folded lexical tokens; not a clinical concept extractor. */
export function lexical_terms(text: string): Set<string> {
  return new Set(casefold(text).match(/[\p{L}\p{N}_]+(?:[-./][\p{L}\p{N}_]+)*/gu) ?? []);
}

/** metrics.filter_terms for a REST event: terms in filter values, excluding transport controls. */
export function filter_terms(event: { route: string; query: string }): Set<string> {
  const values = event.route === 'rest'
    ? parseQsl(urlsplit(event.query).query)
      .filter(([key]) => !key.startsWith('_') || key === '_id')
      .map(([, value]) => value.slice(value.lastIndexOf('|') + 1))
    : [];
  return lexical_terms(values.map((v) => v.replace(/^(?:eq|ne|gt|lt|ge|le|sa|eb|ap)(?=\p{Nd}{4}-)/u, '')).join(' '));
}

/** metrics.query_features for a REST event. */
export function query_features(event: { route: string; query: string }): Rec {
  const query = event.query;
  const result: Rec = { characters: Array.from(query).length, utf8_bytes: utf8Bytes(query).length, route: event.route };
  const keys = parseQsl(urlsplit(query).query).map((p) => p[0]);
  Object.assign(result, {
    parameter_count: keys.length,
    distinct_parameters: new Set(keys).size,
    predicate_count: keys.filter((k) => !k.startsWith('_') || k === '_id').length,
    chain_depth: Math.max(0, ...keys.map((k) => k.split('.').length - 1)),
    includes: keys.filter((k) => k === '_include' || k === '_revinclude').length,
    reverse_chains: keys.filter((k) => k.startsWith('_has:')).length,
    temporal_filters: keys.filter((k) => k === 'date').length,
  });
  return result;
}

export interface StoreEvent {
  route: string;
  via_tool: string | null;
  method: string;
  query: string;
  status: number;
  round: number;
  refs: string[];
  exposed_fields: Record<string, string[]>;
  bytes: number;
  primitive_operations: number;
  total?: number;
  query_features: Rec;
  filter_terms_not_previously_observed: string[];
  [key: string]: unknown;
}

export interface AuditEntry { method: string; ref: string; before: Rec | null; after: Rec | null }
export type Headers = Record<string, string>;
export interface FhirResult { status: number; headers: Headers; body: Rec | null }
export interface StoreOptions {
  writable_patient?: string | null;
  writable_types?: Iterable<string>;
  delete_refs?: Iterable<string>;
  max_calls?: number;
  writable_refs?: Iterable<string>;
  interface?: string;
}
/** fhir_request_object's arguments. */
export interface FhirRequestArgs { method: string; path: string; body?: unknown; if_match?: string; if_none_exist?: string }

type Executed = [number, Rec | null, Headers];
type Snapshot = [Map<string, Rec>, Set<string>, AuditEntry[], number];

// --- the store ------------------------------------------------------------------------------

export class FhirStore {
  initial: Map<string, Rec>;
  resources: Map<string, Rec>;
  deleted = new Set<string>();
  audit: AuditEntry[] = [];
  events: StoreEvent[] = [];
  /**
   * Lexical terms of every response the model has seen (metrics.lexical_terms over the response
   * text); events record which filter terms were new, which the scorer's grounding metrics read.
   */
  observed_terms = new Set<string>();
  assistance: Rec[] = [];
  agent_tools: string[] = [];
  active_tool: string | null = 'fhir_request';
  seen = new Set<string>();
  /** ref -> fields actually returned; SQL ID-only is not full evidence. */
  exposed = new Map<string, Set<string>>();
  writable_patient: string | null;
  writable_types: Set<string>;
  delete_refs: Set<string>;
  writable_refs: Set<string>;
  max_calls: number;
  /** v0.5 validates bodies before authorization and returns actionable errors. */
  interface: string;
  round = 0;
  next_id = 1;
  current_cost = 0;
  unsafe_attempts = 0;

  constructor(resources: Rec[], options: StoreOptions = {}) {
    const writableTypes = [...(options.writable_types ?? [])];
    this.interface = options.interface ?? 'v0.4';
    // Inputs are immutable source snapshots. Tools always return copies; writes replace
    // objects rather than modifying any source object.
    this.initial = new Map(resources.map((r) => [ref(r), r]));
    if (since(this.interface, 'v0.6')) {
      // Every record has a version from v0.6.
      this.initial = new Map([...this.initial].map(([key, r]) => {
        const meta = pyGet(r, 'meta');
        return [key, truthy(meta) && truthy(pyGet(meta, 'versionId')) ? r : { ...r, meta: { ...(truthy(meta) ? (meta as Rec) : {}), versionId: '1' } }];
      }));
    }
    this.resources = new Map([...this.initial].map(([key, r]) => [key, writableTypes.includes(r.resourceType as string) ? deepcopy(r) : r]));
    this.writable_patient = options.writable_patient ?? null;
    this.writable_types = new Set(writableTypes);
    this.delete_refs = new Set(options.delete_refs ?? []);
    this.writable_refs = new Set(options.writable_refs ?? []);
    // Explicit auxiliary scope is only valid for existing scheduling slots.
    for (const key of this.writable_refs) {
      const original = this.initial.get(key);
      if (original === undefined || original.resourceType !== 'Slot') throw new ValueError('Only existing Slots may receive auxiliary write scope');
    }
    this.max_calls = options.max_calls ?? 40;
  }

  metadata(): Rec {
    return {
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: '2026-10-01',
      kind: 'instance',
      fhirVersion: '4.0.1',
      format: ['json'],
      implementation: { description: 'Research in-process FHIR subset' },
      rest: [{
        mode: 'server',
        searchParam: [{ name: '_tag', type: 'token' }],
        resource: [...PARAMS.keys()].map((kind) => ({
          type: kind,
          interaction: ['read', 'search-type', ...(this.writable_types.has(kind) ? ['create', 'update', 'delete'] : [])].map((code) => ({ code })),
          versioning: 'versioned-update',
          conditionalCreate: this.writable_types.has(kind),
          searchParam: sortedStrings(this.search_params(kind)).map((p) => ({
            name: p,
            type: p === 'patient' || hasOwn(REF_FIELDS, p) ? 'reference' : METADATA_DATE_PARAMS.has(p) ? 'date' : p === 'name' ? 'string' : 'token',
          })),
          ...this.searchIncludes(kind),
        })),
      }],
    };
  }

  /** Search parameters this interface supports for a resource type. */
  search_params(kind: string): Set<string> {
    const base = PARAMS.get(kind);
    if (base === undefined) throw new KeyError(kind);
    const extra = since(this.interface, 'v0.6') ? PARAMS_V06.get(kind) ?? new Set<string>() : new Set<string>();
    return new Set([...base, ...extra]);
  }

  private searchIncludes(kind: string): Rec {
    // v0.6 advertises every implemented _include; v0.4/v0.5 listed none.
    const targets = sortedStrings(Object.keys(INCLUDES).filter((k) => k.startsWith(kind + ':')));
    if (!targets.length || !since(this.interface, 'v0.6')) return {};
    return { searchInclude: targets };
  }

  private matches(resource: Rec, key: string, value: string): boolean {
    const colon = key.indexOf(':');
    const base = colon < 0 ? key : key.slice(0, colon);
    const modifier = colon < 0 ? '' : key.slice(colon + 1);
    if (modifier === 'missing') {
      if (value !== 'true' && value !== 'false') throw new ValueError('missing modifier requires true or false');
      const field = hasOwn(CODE_FIELDS, base) ? CODE_FIELDS[base] : hasOwn(REF_FIELDS, base) ? REF_FIELDS[base] : base;
      return !truthy(pyGet(resource, field)) === (value === 'true');
    }
    if (base === '_id') return sub(resource, 'id') === value;
    if (base === '_tag') {
      return iterate(pyGet(pyGet(resource, 'meta', {}), 'tag', [])).some((v) => token_match(v, value));
    }
    if (base === 'patient') {
      const target = value.includes('/') ? value : `Patient/${value}`;
      if (resource.resourceType === 'Appointment') {
        return iterate(pyGet(resource, 'participant', [])).some((p) => pyGet(pyGet(p, 'actor', {}), 'reference') === target);
      }
      return patientRef(resource) === target;
    }
    if (base === 'identifier') return valuesAt(resource, 'identifier').some((v) => token_match(v, value));
    if (base === 'name') {
      return valuesAt(resource, 'name').some((v) => isDict(v)
        ? (pyStr(pyGet(v, 'text', '')) + ' ' + pyStr(pyGet(v, 'family', '')) + ' ' + pyJoin(' ', pyGet(v, 'given', []))).toLowerCase().includes(value.toLowerCase())
        : pyStr(v).toLowerCase().includes(value.toLowerCase()));
    }
    if (base === 'birthdate') return date_match(pyGet(resource, 'birthDate', ''), value);
    if (DATE_PARAMS.has(base)) return date_match(resource_date(resource), value);
    if (base === 'organization' && resource.resourceType === 'HealthcareService') {
      return [...references(pyGet(resource, 'providedBy'))].some((target) => target === value || target.split('/').pop() === value);
    }
    if (hasOwn(REF_FIELDS, base)) {
      return valuesAt(resource, REF_FIELDS[base]).some((v) =>
        [...references(v)].some((target) => target === value || target.split('/').pop() === value));
    }
    let field = hasOwn(CODE_FIELDS, base) ? CODE_FIELDS[base] : hasOwn(OTHER_FIELDS, base) ? OTHER_FIELDS[base] : base;
    if (base === 'code' && inStrings(resource.resourceType, MEDICATION_CODE_TYPES)) {
      field = resource.resourceType === 'DeviceRequest' ? 'codeCodeableConcept' : 'medicationCodeableConcept';
      // Non-standard, kept for replay through v0.6: the search silently follows
      // medicationReference and matches the Medication's code, so the Medication never needs to
      // be read. Standard servers match only medicationCodeableConcept.
      const target = pyGet(pyGet(resource, 'medicationReference', {}), 'reference');
      if (typeof target === 'string' && this.resources.has(target)) {
        return token_match(pyGet(this.resources.get(target)!, 'code'), value);
      }
    }
    return valuesAt(resource, field).some((v) => token_match(v, value));
  }

  private search(kind: string, pairs: [string, string][]): Rec {
    if (!PARAMS.has(kind)) throw new FhirError(400, `Unsupported resource: ${kind}`);
    const include: string[] = [];
    for (const [key, value] of pairs) {
      const base = key.split(':')[0];
      if (key === 'patient.identifier') {
        if (!PARAMS.get(kind)!.has('patient')) throw new FhirError(400, 'Patient chaining unsupported for this resource');
        continue;
      }
      if (key === '_include') {
        if (!hasOwn(INCLUDES, value) || !value.startsWith(kind + ':')) throw new FhirError(400, 'Unsupported include');
        include.push(value);
      } else if (!COMMON.has(key) && (!this.search_params(kind).has(base) || (key.includes(':') && !key.endsWith(':missing')))) {
        throw new FhirError(400, `Unsupported parameter: ${key}` + (since(this.interface, 'v0.5')
          ? `. ${kind} supports ${sortedStrings(this.search_params(kind)).join(', ')}; also _id, _count, _sort, _page, _include, _tag`
          : ''));
      }
    }
    let candidates = [...this.resources.values()].filter((r) => sub(r, 'resourceType') === kind);
    for (const [key, value] of pairs) {
      if (COMMON_SKIPPED.has(key)) continue;
      if (key === 'patient.identifier') {
        const ids = new Set([...this.resources.values()]
          .filter((p) => p.resourceType === 'Patient' && this.matches(p, 'identifier', value)).map(ref));
        candidates = candidates.filter((r) => { const owner = patientRef(r); return owner !== null && ids.has(owner); });
      } else {
        candidates = candidates.filter((r) => value.split(',').some((choice) => this.matches(r, key, choice)));
      }
    }
    const params = new Map(pairs);
    const order = params.get('_sort') ?? '_id';
    const field = order.replace(/^-+/, '');
    if (field !== 'date' && field !== '_id') throw new FhirError(400, 'Only date and _id sort are supported');
    const keyOf = field === 'date' ? resource_date : (r: Rec) => pyStr(sub(r, 'id'));
    const descending = order.startsWith('-');
    candidates = candidates.map((r, i): [string, number, Rec] => [keyOf(r), i, r])
      .sort((a, b) => (cmpStr(a[0], b[0]) * (descending ? -1 : 1)) || a[1] - b[1])
      .map((x) => x[2]);
    const count = pyInt(params.get('_count') ?? '10'), page = pyInt(params.get('_page') ?? '0');
    if (!(count >= 1 && count <= 50) || !(page >= 0 && page <= 10000)) throw new FhirError(400, 'Invalid page size or offset');
    const selected = candidates.slice(page * count, (page + 1) * count);
    const entries: Rec[] = selected.map((r) => ({ fullUrl: ref(r), resource: deepcopy(r), search: { mode: 'match' } }));
    const included = new Set(selected.map(ref));
    for (const directive of include) {
      const field2 = INCLUDES[directive];
      for (const resource of selected) {
        for (const target of references(pyGet(resource, field2))) {
          if (this.resources.has(target) && !included.has(target)) {
            entries.push({ fullUrl: target, resource: deepcopy(this.resources.get(target)), search: { mode: 'include' } });
            included.add(target);
          }
        }
      }
    }
    const bundle: Rec = { resourceType: 'Bundle', type: 'searchset', total: candidates.length, entry: entries };
    if ((page + 1) * count < candidates.length) {
      const rest = pairs.filter(([k]) => k !== '_page').concat([['_page', String(page + 1)]]);
      bundle.link = [{ relation: 'next', url: kind + '?' + urlencode(rest) }];
    }
    return bundle;
  }

  private authorize(resource: Rec, del = false): void {
    if (
      since(this.interface, 'v0.5') && !del &&
      inStrings(pyGet(resource, 'resourceType'), this.writable_types) &&
      patientRef(resource) === null &&
      (!truthy(pyGet(resource, 'id')) || !this.writable_refs.has(ref(resource)))
    ) {
      // Malformed, not unsafe: the write names no patient at all.
      throw new FhirError(400, `Writes in this episode must reference ${pyStr(this.writable_patient)} (for example in subject, patient or for)`);
    }
    if (pyGet(resource, 'resourceType') === 'Slot' && truthy(pyGet(resource, 'id'))) {
      const original = this.initial.get(ref(resource));
      if (original && truthy(original)) {
        const keys = new Set([...Object.keys(resource), ...Object.keys(original)]);
        keys.delete('status');
        keys.delete('meta');
        if ([...keys].some((k) => !pyEq(pyGet(resource, k), pyGet(original, k)))) {
          this.unsafe_attempts += 1;
          throw new FhirError(403, 'Auxiliary Slot permission allows status changes only');
        }
      }
    }
    if (
      !inStrings(subscript(resource, 'resourceType'), this.writable_types) ||
      (patientRef(resource) !== this.writable_patient && (!truthy(pyGet(resource, 'id')) || !this.writable_refs.has(ref(resource)))) ||
      (del && !this.delete_refs.has(ref(resource)))
    ) {
      this.unsafe_attempts += 1;
      throw new FhirError(403, "Write outside this episode's patient/type/delete policy");
    }
  }

  private notFound(path: string): string {
    if (!since(this.interface, 'v0.5')) return 'Resource not found';
    return `Resource not found: ${path}. Type/id takes the server id; find business identifiers with Type?identifier=value`;
  }

  private execute(method: string, path: unknown, body: unknown, headers: Headers): Executed {
    if (Array.isArray(path) || isDict(path)) throw new TypeError_(`unhashable type: '${pyTypeName(path)}'`);
    if (typeof path !== 'string') throw new AttributeError(`'${pyTypeName(path)}' object has no attribute 'decode'`);
    const parsed = urlsplit(path);
    if (parsed.scheme || parsed.netloc || path.includes('..') || Array.from(path).length > 8192) {
      throw new FhirError(400, 'Use bounded relative FHIR paths');
    }
    const clean = stripSlashes(parsed.path);
    const pairs = parseQsl(parsed.query, true);
    if (method === 'GET' && clean === 'metadata') return [200, this.metadata(), {}];
    const parts = clean ? clean.split('/') : [];
    if (method === 'GET') {
      if (parts.length === 1) return [200, this.search(clean, pairs), {}];
      if (parts.length === 2 && !pairs.length) {
        if (this.deleted.has(clean)) throw new FhirError(410, 'Resource deleted');
        const r = this.resources.get(clean);
        if (r === undefined) throw new FhirError(404, this.notFound(clean));
        // v0.4/v0.5 keep the 400 on versionless records for replay; v0.6 assigns every record a version at load.
        return [200, deepcopy(r), { ETag: `W/"${pyStr(subscript(subscript(r, 'meta'), 'versionId'))}"` }];
      }
      throw new FhirError(400, 'Unsupported GET path' + (since(this.interface, 'v0.5') ? '; use relative Type/id, Type?param=value or metadata' : ''));
    }
    if (method === 'POST' && !clean) return this.transaction(body);
    if (method === 'POST' && parts.length === 1 && !pairs.length) return this.create(method, clean, body, headers);
    if (parts.length !== 2 || pairs.length || (method !== 'PUT' && method !== 'DELETE')) {
      throw new FhirError(400, 'Supported methods: GET, POST, PUT, DELETE; no upsert');
    }
    const old = this.resources.get(clean);
    if (old === undefined) throw new FhirError(404, this.notFound(clean));
    this.authorize(old, method === 'DELETE');
    if (headers['If-Match'] !== `W/"${pyStr(subscript(subscript(old, 'meta'), 'versionId'))}"`) {
      throw new FhirError(412, 'A current If-Match ETag is required' + (since(this.interface, 'v0.5')
        ? `; send W/"{meta.versionId}" from your latest read of ${clean}, or entry.request.ifMatch inside a transaction Bundle`
        : ''));
    }
    if (method === 'DELETE') {
      for (const [key, r] of this.resources) {
        if (key !== clean && refersTo(r, clean)) throw new FhirError(409, 'Resource is referenced');
      }
      this.deleted.add(clean);
      this.resources.delete(clean);
      this.audit.push({ method, ref: clean, before: deepcopy(old), after: null });
      return [204, null, {}];
    }
    if (!isDict(body) || ref(body) !== clean) throw new FhirError(400, 'PUT identity mismatch');
    let sent: Rec = body;
    if (since(this.interface, 'v0.6')) sent = coerce_typed_strings(sent) as Rec;  // String-serialized numbers and booleans are a chat-template artifact.
    if (since(this.interface, 'v0.5')) validate_resource(sent);
    this.authorize(sent);
    const r = deepcopy(sent);
    if (since(this.interface, 'v0.6')) r.meta = carryMeta(truthy(pyGet(old, 'meta')) ? old.meta : {}, truthy(pyGet(r, 'meta')) ? r.meta : {});
    const versionId = String(toInt(subscript(subscript(old, 'meta'), 'versionId')) + 1);
    r.meta = { ...spreadMeta(r), versionId };
    validate_resource(r);
    validate_contracts([r]);
    this.resources.set(clean, r);
    this.audit.push({ method, ref: clean, before: deepcopy(old), after: deepcopy(r) });
    return [200, deepcopy(r), { ETag: `W/"${versionId}"` }];
  }

  private transaction(body: unknown): Executed {
    if (!isDict(body) || body.resourceType !== 'Bundle' || body.type !== 'transaction') {
      throw new FhirError(400, 'POST root requires a transaction Bundle');
    }
    const entries = pyGet(body, 'entry', []);
    if (!truthy(entries) || lenOf(entries) > 20) throw new FhirError(400, 'Transaction must have 1–20 entries');
    const results: Rec[] = [];
    const snapshot: Snapshot = [new Map(this.resources), new Set(this.deleted), this.audit.slice(), this.next_id];
    try {
      for (const entry of iterate(entries)) {
        const request = subscript(entry, 'request');
        const verb = subscript(request, 'method'), url = subscript(request, 'url');
        if (!inStrings(verb, WRITE_VERBS) || !truthy(url)) throw new FhirError(400, 'Only non-nested write transactions are supported');
        this.current_cost += 1;
        const headers: Headers = {};
        const ifMatch = pyGet(request, 'ifMatch'), ifNoneExist = pyGet(request, 'ifNoneExist');
        if (truthy(ifMatch)) headers['If-Match'] = ifMatch as string;
        if (truthy(ifNoneExist)) headers['If-None-Exist'] = ifNoneExist as string;
        const [status, payload, hdr] = this.execute(verb as string, url, pyGet(entry, 'resource'), headers);
        results.push({
          response: { status: String(status), ...(hasOwn(hdr, 'Location') ? { location: hdr.Location } : {}) },
          ...(truthy(payload) ? { resource: payload } : {}),
        });
      }
      validate_graph([...this.resources.values()], false);
    } catch (error) {
      [this.resources, this.deleted, this.audit, this.next_id] = snapshot;
      throw error;
    }
    return [200, { resourceType: 'Bundle', type: 'transaction-response', entry: results }, {}];
  }

  private create(method: string, clean: string, body: unknown, headers: Headers): Executed {
    if (!isDict(body) || body.resourceType !== clean) throw new FhirError(400, 'POST resource type mismatch');
    let r = deepcopy(body);
    if (truthy(pyGet(r, 'id'))) throw new FhirError(400, 'Server assigns IDs on create');
    if (since(this.interface, 'v0.6')) r = coerce_typed_strings(r) as Rec;
    if (since(this.interface, 'v0.5')) {
      if (clean === 'Bundle' && inStrings(pyGet(r, 'type'), new Set(['transaction', 'batch']))) {
        throw new FhirError(400, 'POST transaction Bundles to the server root (empty path)');
      }
      validate_resource(r);
    }
    this.authorize(r);
    const conditional = headers['If-None-Exist'];
    if (conditional !== undefined) {
      const conditions = parseQsl(conditional, true);
      if (!conditions.length || conditions.some(([key]) => key.startsWith('_') && key !== '_id')) {
        throw new FhirError(400, 'Conditional create requires resource filters only; paging, controls and includes are unsupported');
      }
      const matches = this.search(clean, conditions);
      if ((matches.total as number) > 1) throw new FhirError(412, 'Conditional create is ambiguous');
      if (matches.total === 1) {
        const existing = ((matches.entry as Rec[])[0]).resource as Rec;
        return [200, existing, { Location: ref(existing) }];
      }
    }
    r.id = `created-${String(this.next_id).padStart(5, '0')}`;
    while (this.resources.has(ref(r))) {
      this.next_id += 1;
      r.id = `created-${String(this.next_id).padStart(5, '0')}`;
    }
    this.next_id += 1;
    r.meta = { ...spreadMeta(r), versionId: '1' };
    validate_resource(r);
    validate_contracts([r]);
    this.resources.set(ref(r), r);
    this.audit.push({ method, ref: ref(r), before: null, after: deepcopy(r) });
    return [201, deepcopy(r), { Location: ref(r), ETag: 'W/"1"' }];
  }

  observe(resource: Rec, fields: Iterable<string> | null = null): void {
    const key = ref(resource);
    this.seen.add(key);
    let known = this.exposed.get(key);
    if (known === undefined) this.exposed.set(key, known = new Set());
    for (const f of fields === null ? Object.keys(resource) : fields) known.add(f);
  }

  /** Remember the lexical terms of a response, so later filters can be judged new or seen. */
  observe_response_terms(text: string): void {
    for (const term of lexical_terms(text)) this.observed_terms.add(term);
  }

  request(method: string, path: string, body: unknown = null, headers: Headers | null = null, visible_fields: Iterable<string> | null = null): FhirResult {
    method = method.toUpperCase();
    if (typeof path !== 'string') throw new AttributeError(`'${pyTypeName(path)}' object has no attribute 'strip'`);
    this.current_cost = method === 'POST' && !stripSlashes(path) ? 0 : 1;
    const before: Snapshot | null = method !== 'GET'
      ? [new Map(this.resources), new Set(this.deleted), this.audit.slice(), this.next_id]
      : null;
    const visible = visible_fields === null ? null : [...visible_fields];
    let result: FhirResult;
    try {
      if (this.events.length >= this.max_calls) throw new FhirError(429, 'Episode tool-call budget exhausted');
      const [status, payload, responseHeaders] = this.execute(method, path, body, headers ?? {});
      if (method !== 'GET') validate_graph([...this.resources.values()], false);
      result = { status, headers: responseHeaders, body: payload };
    } catch (error) {
      if (!isCaught(error)) throw error;
      if (before !== null) [this.resources, this.deleted, this.audit, this.next_id] = before;
      result = {
        status: error instanceof FhirError ? error.status : 400,
        headers: {},
        body: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'processing', diagnostics: error.message }] },
      };
    }
    let returned: Rec[] = [];
    if (result.status < 300 && truthy(result.body)) {
      const payload = result.body!;
      if (payload.resourceType === 'Bundle') {
        returned = (iterate(pyGet(payload, 'entry', [])) as Rec[]).filter((e) => hasOwn(e, 'resource')).map((e) => e.resource as Rec);
      } else if (truthy(pyGet(payload, 'id'))) returned = [payload];
      for (const resource of returned) this.observe(resource, visible);
    }
    const event = {
      route: 'rest',
      via_tool: this.active_tool,
      method,
      query: path,
      status: result.status,
      round: this.round,
      refs: returned.map(ref),
      exposed_fields: {} as Record<string, string[]>,
      bytes: pyDumpsAscii(result).length,
      primitive_operations: this.current_cost,
    } as StoreEvent;
    for (const r of returned) event.exposed_fields[ref(r)] = visible === null ? Object.keys(r) : [...visible];
    this.events.push(event);
    if (isDict(result.body) && result.body.type === 'searchset') event.total = result.body.total as number;
    event.query_features = query_features(event);
    event.filter_terms_not_previously_observed = sortedStrings([...filter_terms(event)].filter((t) => !this.observed_terms.has(t)));
    if (visible === null && (this.active_tool === null || this.active_tool === 'fhir_request')) {
      this.observe_response_terms(pyDumpsAscii(result));
    }
    return result;
  }

  /** fhir_request_object: Python's json.dumps(store.request(...), ensure_ascii=False). */
  fhirRequestObject(args: FhirRequestArgs): string {
    const headers: Headers = {};
    if (truthy(args.if_match)) headers['If-Match'] = args.if_match!;
    if (truthy(args.if_none_exist)) headers['If-None-Exist'] = args.if_none_exist!;
    return pyDumps(this.request(args.method, args.path, truthy(args.body) ? args.body : null, headers));
  }
}

function refersTo(resource: Rec, target: string): boolean {
  for (const found of references(resource)) if (found === target) return true;
  return false;
}

/** {**r.get("meta", {})}: the stored meta, or TypeError when it is not a mapping. */
function spreadMeta(r: Rec): Rec {
  return hasOwn(r, 'meta') ? spreadValue(r.meta) : {};
}
function spreadValue(v: unknown): Rec {
  if (!isDict(v)) throw new TypeError_(`'${pyTypeName(v)}' object is not a mapping`);
  return v;
}

/** The isolated chart an episode starts from (episode_store): copies the shard minus `omit`, with the task's write scope. */
export function episodeStore(
  task: { patient_id: string; omit: string[]; writable_types: string[]; delete_refs: string[]; writable_refs?: string[] },
  shardResources: Rec[],
  maxCalls: number,
  interfaceName = 'v0.4',
  texts: Iterable<string> = [],
): FhirStore {
  const omit = new Set(task.omit);
  const resources = shardResources.filter((r) => !omit.has(ref(r))).map((r) => deepcopy(r));
  const store = new FhirStore(resources, {
    writable_patient: 'Patient/' + task.patient_id,
    writable_types: task.writable_types,
    delete_refs: task.delete_refs,
    writable_refs: task.writable_refs ?? [],
    max_calls: maxCalls,
    interface: interfaceName,
  });
  for (const text of texts) store.observe_response_terms(text);
  return store;
}
