// The trace explanations of demo/app.py (run_agent's plain-language steps, sources, claims
// and verification) for the static Chart assistant page. tests/test_chart_trace.py checks
// every export against the Python functions, byte for byte as JSON.
//
// Resource-wide rendering stays in Python: browser_demo/scripts/chart_precompute.py's
// trace_inputs(session) gives `inputs` = {names, cards}. Before use, attach the chart's
// records as inputs.resources (a Map or object, reference -> resource, e.g. the in-page
// FhirStore's .resources, parsed with pyParse). Functions that took `session` or
// `resources` in Python take `inputs` here.
//
// Python semantics kept on purpose: str.strip/split whitespace, code-point lengths and
// slices, Unicode \d \w \b in regexes, json.loads (duplicate keys, NaN constants) and
// Python-style str() of values. Known gaps: integer-like object keys ("123") are reordered
// by JS (final.names, answers keyed by numbers); integers beyond 2**53 lose precision.
//
// Parsed JSON is typed `unknown` and narrowed with isDict and friends; the few casts mark
// places where Python would raise first or where the chart's JSON is known to fit.

import { PyFloat, pyDumps, references } from '../fhir/fhir_store.ts';
import { pyEq } from '../fhir/pyrt.ts';
import { resource_date } from '../fhir/store.ts';
import type { BenchTask } from '../types.ts';

// --- Public types ---------------------------------------------------------------------------

/** A JSON object as pyLoads/pyParse returns it (values unchecked; floats may be PyFloat). */
export type JsonObject = Record<string, unknown>;

/** A card without ref and type: [record_date, safe_label, status_text] (trace_inputs). */
export type CardTuple = [date: string | null, label: string, status: string];

/** A chart's records: a Map or object, reference -> resource (e.g. FhirStore.resources). */
export type ResourceLookup = Map<string, unknown> | Record<string, unknown>;

/** chart_precompute.trace_inputs(session), plus the chart's records attached as resources. */
export interface Inputs {
  /** code -> display name (app.code_names). */
  names: Record<string, string>;
  /** reference -> precomputed card. */
  cards: Record<string, CardTuple>;
  resources?: ResourceLookup | null;
}

/** The ChartIndex patient fields the trace reads (a ChartPatient fits). */
export interface TracePatient {
  id: string;
  ref: string;
}

/** reference -> the call numbers that returned it, in first-seen order (Map or object). */
export type Retrieved = Map<string, number[]> | Record<string, number[]>;

/** An HTTP status from the tool result, or null when the tool did not run (no JSON status). */
export type Status = number | null;

/** describe_result: [status, summary, refs]. */
export type ResultDescription = [status: Status, summary: string, refs: string[]];

/** How the final reply was read (read_answer's form). */
export type AnswerForm = 'json' | 'fenced json' | 'embedded json' | 'text';

/** A path into the answer: keys and list indexes (answer_entries). */
export type AnswerPath = (string | number)[];

/** One part of the answer and the records that state it (answer_claims). */
export interface Claim {
  path: AnswerPath;
  sources: string[];
  /** true: found among cited records; false: among records only read; null: none. */
  cited: boolean | null;
}

/** final_answer(text, finish_reason); finishTrace adds claims and names. */
export interface FinalAnswer {
  text: string;
  format: AnswerForm;
  parsed: JsonObject | null;
  answer: unknown;
  shown: unknown;
  evidence: string[];
  warnings: string[];
  claims?: Claim[];
  names?: Record<string, string>;
}

/** card(resource, resources) for a record in the chart. */
export interface Card {
  ref: string;
  type: string | null;
  date: string | null;
  label: string;
  status: string;
}

/** One row of run_sources. */
export interface SourceRow extends Card {
  exists: boolean;
  calls: number[];
  cited: boolean;
  /** Whether the record is in the task's gold set; null outside a compiled task. */
  gold: boolean | null;
}

/** One tool step's explanation fields (toolStepWords). refs are all of them, not capped. */
export interface ToolStepWords {
  status: Status;
  summary: string;
  refs: string[];
  plain: string;
  outcome: string;
  write: boolean;
  error: boolean;
}

/** stated(value): what an answer part states. */
export interface Stated {
  refs: Set<string>;
  dates: Set<string>;
  numbers: Set<number>;
  texts: Set<string>;
}

/** record_terms(resource): what a record states; texts map text -> weight. */
export interface RecordTerms {
  dates: Set<string>;
  numbers: Set<number>;
  texts: Map<string, number>;
}

export type VerificationState = 'none' | 'unreadable' | 'not_found' | 'partial' | 'verified' | 'unsupported';

/** verification(final, ...): whether the cited records were read and support the answer. */
export interface Verification {
  state: VerificationState;
  supporting: string[];
  unchecked: { ref: string; reason: string }[];
  patient: boolean;
}

/** A write the chart refused, as trace.refused_changes lists it. */
export interface RefusedChange {
  call: number;
  plain: string;
  outcome: string;
  status: Status;
}

/** A model turn in the trace (other fields pass through). */
export interface AssistantStep {
  type: 'assistant';
  [key: string]: unknown;
}

/** A tool call in the trace: toolStepWords plus the call number (other fields pass through). */
export interface ToolStep {
  type: 'tool';
  call: number;
  status: Status;
  plain: string;
  outcome: string;
  write: boolean;
  error: boolean;
  [key: string]: unknown;
}

export type Step = AssistantStep | ToolStep;

/** The trace fields finishTrace reads and fills; run_agent's other fields pass through. */
export interface Trace {
  steps: Step[];
  final: FinalAnswer | null;
  changes?: unknown[];
  sandbox_changes?: number;
  sources?: SourceRow[];
  verification?: Verification;
  refused_changes?: RefusedChange[];
}

/** A compiled task as finishTrace reads it (a BenchTask fits). */
export type TraceTask = Pick<BenchTask, 'gold'>;

// --- Python string helpers ----------------------------------------------------------------

const WS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WS_RUN = new RegExp(`[${WS}]+`, 'g');
const WS_LEAD = new RegExp(`^[${WS}]+`);
const WS_TRAIL = new RegExp(`[${WS}]+$`);
const LINE_BREAK = /[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;
const W = '[\\p{L}\\p{N}_]';
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;  // Python's Unicode \b

const strip = (s: string): string => s.replace(WS_LEAD, '').replace(WS_TRAIL, '');
const lstrip = (s: string): string => s.replace(WS_LEAD, '');
const splitWs = (s: string): string[] => s.split(WS_RUN).filter(Boolean);
const squash = (s: string): string => splitWs(s).join(' ');
const cpLen = (s: string): number => { let n = 0; for (const _ of s) n++; return n; };
const cpSlice = (s: string, n: number): string => (s.length <= n ? s : Array.from(s).slice(0, n).join(''));
const firstLine = (s: string): string => strip(s).split(LINE_BREAK)[0];
const isDict = (v: unknown): v is JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PyFloat);
const numeric = (v: unknown): v is number | PyFloat => (typeof v === 'number') || v instanceof PyFloat;
// Own-key test; throws TypeError for null/undefined like the JS original.
const has = (obj: unknown, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(obj, key);

function setKey(obj: object, key: string, value: unknown): void {  // obj[key] = value, safe for "__proto__"
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function truthy(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === '' || v === 0) return false;
  if (v instanceof PyFloat) return v.value !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}

function floatRepr(x: number): string { return new PyFloat(x).toString(); }

function strRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === quote || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch !== ' ' && /[\p{C}\p{Z}]/u.test(ch)) {
      out += c < 0x100 ? '\\x' + c.toString(16).padStart(2, '0')
        : c < 0x10000 ? '\\u' + c.toString(16).padStart(4, '0') : '\\U' + c.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return out + quote;
}

function pyRepr(v: unknown): string {
  if (typeof v === 'string') return strRepr(v);
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
  if (isDict(v)) return '{' + Object.entries(v).map(([k, x]) => strRepr(k) + ': ' + pyRepr(x)).join(', ') + '}';
  return pyStr(v);
}

// Python's str(value) for a JSON value.
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v instanceof PyFloat) return floatRepr(v.value);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : floatRepr(v);
  if (typeof v === 'string') return v;
  return pyRepr(v);
}

// Iterating a Python value: list items, string characters, dict keys; else TypeError.
function pyIter(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return Array.from(v);
  if (isDict(v)) return Object.keys(v);
  throw new TypeError('not iterable');
}

function pyGet(obj: unknown, key: string, fallback: unknown = null): unknown {  // obj.get(key, fallback), AttributeError off dicts
  if (!isDict(obj)) throw new TypeError("object has no attribute 'get'");
  return has(obj, key) ? obj[key] : fallback;
}

function pyJoin(sep: string, items: unknown[]): string {
  for (const item of items) if (typeof item !== 'string') throw new TypeError('sequence item: expected str');
  return items.join(sep);
}

function hashable<T>(key: T): T {
  if (Array.isArray(key) || isDict(key)) throw new TypeError('unhashable type');
  return key;
}

// --- json.loads ---------------------------------------------------------------------------

class JSONError extends Error {}

// Python's json scanner: whitespace " \t\n\r", ASCII numbers (floats as PyFloat), strict
// strings. pairs: 'unique' rejects duplicate keys and NaN/Infinity (parse_object's hooks).
function scan(text: string, i: number, strictPairs: boolean): [unknown, number] {
  // A declaration (not an arrow) so the checker sees `never` and narrows after fail().
  function fail(msg: string): never { throw new JSONError(msg); }
  const skip = (j: number): number => { while (j < text.length && ' \t\n\r'.includes(text[j])) j++; return j; };
  function value(j: number): [unknown, number] {
    const ch = text[j];
    if (ch === '"') return string(j + 1);
    if (ch === '{') return object(j + 1);
    if (ch === '[') return array(j + 1);
    if (text.startsWith('null', j)) return [null, j + 4];
    if (text.startsWith('true', j)) return [true, j + 4];
    if (text.startsWith('false', j)) return [false, j + 5];
    for (const [word, x] of [['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity]] as const) {
      if (text.startsWith(word, j)) {
        if (strictPairs) fail('Non-JSON numeric constant');
        return [new PyFloat(x), j + word.length];
      }
    }
    const m = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
    m.lastIndex = j;
    const found = m.exec(text);
    if (!found) fail('Expecting value');
    const n = Number(found[0]);
    return [found[1] || found[2] ? new PyFloat(n) : n, j + found[0].length];
  }
  function string(j: number): [string, number] {
    let out = '';
    for (;;) {
      if (j >= text.length) fail('Unterminated string');
      const ch = text[j];
      if (ch === '"') return [out, j + 1];
      if (ch === '\\') {
        const e = text[j + 1];
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in simple) { out += simple[e]; j += 2; continue; }
        if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(j + 2, j + 6))) {
          out += String.fromCharCode(parseInt(text.slice(j + 2, j + 6), 16));
          j += 6;
          continue;
        }
        fail('Invalid \\escape');
      }
      if (ch.charCodeAt(0) < 0x20) fail('Invalid control character');
      out += ch;
      j++;
    }
  }
  function object(j: number): [JsonObject, number] {
    const out: JsonObject = {};
    j = skip(j);
    if (text[j] === '}') return [out, j + 1];
    for (;;) {
      if (text[j] !== '"') fail('Expecting property name enclosed in double quotes');
      let key: string;
      [key, j] = string(j + 1);
      j = skip(j);
      if (text[j] !== ':') fail("Expecting ':' delimiter");
      let item: unknown;
      [item, j] = value(skip(j + 1));
      if (strictPairs && has(out, key)) fail('Duplicate JSON key');
      setKey(out, key, item);
      j = skip(j);
      if (text[j] === '}') return [out, j + 1];
      if (text[j] !== ',') fail("Expecting ',' delimiter");
      j = skip(j + 1);
    }
  }
  function array(j: number): [unknown[], number] {
    const out: unknown[] = [];
    j = skip(j);
    if (text[j] === ']') return [out, j + 1];
    for (;;) {
      let item: unknown;
      [item, j] = value(j);
      out.push(item);
      j = skip(j);
      if (text[j] === ']') return [out, j + 1];
      if (text[j] !== ',') fail("Expecting ',' delimiter");
      j = skip(j + 1);
    }
  }
  return value(i);
}

// json.loads(text); throws JSONError where Python raises ValueError.
export function pyLoads(text: string, strictPairs = false): unknown {
  if (text.startsWith('\ufeff')) throw new JSONError('Unexpected UTF-8 BOM');
  const skip = (j: number): number => { while (j < text.length && ' \t\n\r'.includes(text[j])) j++; return j; };
  const [value, end] = scan(text, skip(0), strictPairs);
  if (skip(end) !== text.length) throw new JSONError('Extra data');
  return value;
}

const FENCE = new RegExp(`^[${WS}]*\`\`\`(?:json)?[${WS}]*\\n([\\s\\S]*?)\\n\`\`\`[${WS}]*$`);

// fhir_query_rl.protocol.parse_object
export function parseObject(text: unknown, allowFence = false): JsonObject {
  if (typeof text !== 'string' || cpLen(text) > 65536) throw new JSONError('Expected one JSON object');
  let source = text;
  if (allowFence) {
    const match = FENCE.exec(source);
    if (match) source = match[1];
  }
  const result = pyLoads(source, true);
  if (!isDict(result)) throw new JSONError('Expected one JSON object');
  return result;
}

// --- Agent loop helpers ---------------------------------------------------------------------

const THINK = /<think>([\s\S]*?)<\/think>/g;
const UNPARSED_TOOL_CALL = new RegExp(`<tool_call>|<function=|"name"[${WS}]*:[${WS}]*"fhir_request"`);

// split_reasoning(message) -> [reasoning, visible text]
export function splitReasoning(message: JsonObject): [reasoning: string, content: string] {
  const raw = message.content;
  const joined = Array.isArray(raw) ? raw.filter(isDict).map((part) => (has(part, 'text') ? part.text : '')).join('') : raw;
  let content = typeof joined === 'string' ? joined : '';
  const reasoning = ['reasoning_content', 'reasoning', 'thinking']
    .filter((key) => typeof message[key] === 'string' && has(message, key)).map((key) => message[key] as string);
  const inline = [...content.matchAll(THINK)].map((m) => m[1]);
  if (inline.length) {
    reasoning.push(...inline);
    content = content.replace(THINK, '');
  } else if (content.includes('</think>')) {
    const at = content.indexOf('</think>');
    reasoning.push(content.slice(0, at).replace('<think>', ''));
    content = content.slice(at + '</think>'.length);
  } else if (lstrip(content).startsWith('<think>')) {
    reasoning.push(lstrip(content).slice('<think>'.length));
    content = '';
  }
  const unique = [...new Set(reasoning.map(strip).filter(Boolean))];
  return [unique.join('\n\n'), strip(content)];
}

// read_answer(text) -> [object or null, form]
export function readAnswer(text: string): [JsonObject | null, AnswerForm] {
  for (const [allowFence, form] of [[false, 'json'], [true, 'fenced json']] as const) {
    try { return [parseObject(text, allowFence), form]; } catch (e) { if (!(e instanceof JSONError)) throw e; }
  }
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    let value: unknown;
    try { [value] = scan(text, i, false); } catch (e) { if (e instanceof JSONError) continue; throw e; }
    if (isDict(value)) return [value, 'embedded json'];
  }
  return [null, 'text'];
}

// final_answer(text, finish_reason): {text, format, parsed, answer, shown, evidence, warnings}
export function finalAnswer(text: string, finishReason: string | null | undefined): FinalAnswer {
  const [parsed, form] = readAnswer(text);
  const warnings: string[] = [];
  if (finishReason === 'length') warnings.push('The reply stopped at max_tokens (finish_reason=length).');
  if (UNPARSED_TOOL_CALL.test(text)) {
    warnings.push(
      'The reply contains tool-call text but the server returned no structured ' +
      "tool_calls. Enable the server's tool parser (vLLM: --enable-auto-tool-choice " +
      '--tool-call-parser qwen3_coder for LFM3; llama.cpp: --jinja).',
    );
  }
  if (parsed === null) warnings.push('The reply is not a JSON object.');
  else if (Object.keys(parsed).length !== 2 || !has(parsed, 'answer') || !has(parsed, 'evidence')) {
    warnings.push('The benchmark expects exactly the keys answer and evidence.');
  } else if (form === 'embedded json') {
    warnings.push('Extra text around the JSON object; the benchmark would reject it.');
  }
  const evidence = parsed && has(parsed, 'evidence') ? parsed.evidence : null;
  return {
    text,
    format: form,
    parsed,
    answer: parsed && has(parsed, 'answer') ? parsed.answer : null,
    shown: answerShown(parsed, text),
    evidence: Array.isArray(evidence) ? evidence.filter((e): e is string => typeof e === 'string') : [],
    warnings,
  };
}

// describe_result(content) -> [status, summary, refs]
export function describeResult(content: string): ResultDescription {
  let result: unknown;
  try { result = pyLoads(content); } catch (e) {
    if (!(e instanceof JSONError)) throw e;
    return [null, cpSlice(firstLine(content), 300), []];
  }
  if (!isDict(result) || !has(result, 'status')) return [null, '', []];
  const body = has(result, 'body') ? result.body : null;
  let refs: string[] = [], summary = '';
  if (isDict(body)) {
    const kind = has(body, 'resourceType') ? body.resourceType : null;
    if (kind === 'Bundle') {
      const entries = pyIter(truthy(body.entry) ? body.entry : []).filter(isDict);
      for (const entry of entries) {
        const resource = has(entry, 'resource') ? entry.resource : null;
        if (truthy(entry.fullUrl)) refs.push(entry.fullUrl as string);  // as given (a string from the chart)
        else if (isDict(resource) && truthy(resource.id)) {
          refs.push(`${pyStr(has(resource, 'resourceType') ? resource.resourceType : null)}/${pyStr(resource.id)}`);
        }
      }
      summary = strip(`Bundle ${has(body, 'type') ? pyStr(body.type) : ''}`);
      if (has(body, 'total')) summary += `, total ${pyStr(body.total)}`;
      summary += `, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;
    } else if (kind === 'OperationOutcome') {
      summary = pyIter(truthy(body.issue) ? body.issue : [])
        .map((issue) => pyStr(pyGet(issue, 'diagnostics', ''))).join('; ');
    } else if (truthy(kind) && truthy(body.id)) {
      refs = [`${pyStr(kind)}/${pyStr(body.id)}`];
      summary = refs[0];
      const version = pyGet(truthy(body.meta) ? body.meta : {}, 'versionId');
      if (truthy(version)) summary += ` (version ${pyStr(version)})`;
    } else {
      summary = (truthy(kind) ? kind : '') as string;  // `kind or ''`, as given
    }
  } else if (body === null) {
    summary = 'no body';
  }
  return [result.status as Status, summary, refs];  // the chart's integer status
}

// --- Chart vocabulary (app.py constants) ----------------------------------------------------

const REF_PATTERN = /^[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]{1,64}$/;
const MRN_SYSTEM = 'https://fhir-workflows.example/mrn';
const LABEL_CHARS = 160;
const LABEL_FIELDS = ['title', 'description', 'code', 'type', 'name', 'category', 'serviceType', 'vaccineCode', 'activity'];
const ENCOUNTER_CLASSES: Record<string, string> = {
  AMB: 'ambulatory', EMER: 'emergency', IMP: 'inpatient', ACUTE: 'inpatient acute',
  NONAC: 'inpatient non-acute', OBSENC: 'observation', PRENC: 'pre-admission',
  SS: 'short stay', HH: 'home health', VR: 'virtual', FLD: 'field',
};
const TYPE_NOUNS: Record<string, [string, string]> = {
  Patient: ['patient', 'patients'], Observation: ['result', 'results'],
  DiagnosticReport: ['report', 'reports'], DocumentReference: ['note', 'notes'],
  Composition: ['document', 'documents'], Encounter: ['visit', 'visits'],
  Condition: ['problem', 'problems'], AllergyIntolerance: ['allergy', 'allergies'],
  MedicationRequest: ['prescription', 'prescriptions'],
  MedicationStatement: ['medication entry', 'medication entries'],
  MedicationDispense: ['pharmacy dispense', 'pharmacy dispenses'],
  MedicationAdministration: ['dose record', 'dose records'],
  Medication: ['medication', 'medications'], ServiceRequest: ['order', 'orders'],
  Procedure: ['procedure', 'procedures'], Immunization: ['immunization', 'immunizations'],
  ImagingStudy: ['imaging study', 'imaging studies'], Specimen: ['specimen', 'specimens'],
  Appointment: ['appointment', 'appointments'],
  AppointmentResponse: ['appointment reply', 'appointment replies'],
  Slot: ['schedule slot', 'schedule slots'], Schedule: ['schedule', 'schedules'],
  Coverage: ['insurance coverage', 'insurance coverages'],
  CoverageEligibilityRequest: ['eligibility check', 'eligibility checks'],
  CoverageEligibilityResponse: ['eligibility result', 'eligibility results'],
  CareTeam: ['care team', 'care teams'], CarePlan: ['care plan', 'care plans'],
  Goal: ['goal', 'goals'], Consent: ['consent', 'consents'], Flag: ['alert', 'alerts'],
  Task: ['task', 'tasks'], Communication: ['message', 'messages'],
  CommunicationRequest: ['message request', 'message requests'],
  Practitioner: ['clinician', 'clinicians'], PractitionerRole: ['clinician role', 'clinician roles'],
  Organization: ['organization', 'organizations'], Location: ['location', 'locations'],
  RelatedPerson: ['contact person', 'contact people'], Provenance: ['audit record', 'audit records'],
  EpisodeOfCare: ['episode of care', 'episodes of care'],
  DetectedIssue: ['flagged issue', 'flagged issues'],
  QuestionnaireResponse: ['questionnaire answer', 'questionnaire answers'],
};

// noun(kind, many): MedicationRequest -> prescription
export function noun(kind: unknown, many = false): string {
  if (typeof kind === 'string' && has(TYPE_NOUNS, kind)) return TYPE_NOUNS[kind][many ? 1 : 0];
  const words = (truthy(kind) ? pyStr(kind) : 'record').replace(/(?<=[a-z])(?=[A-Z])/g, ' ').toLowerCase();
  return words + (many ? 's' : '');
}

// The inputs' lookups: the record itself, and its precomputed card [date, label, status].
const resourceOf = (inputs: Inputs, key: string): unknown => {
  const rs = inputs.resources;
  if (!rs) return undefined;
  return rs instanceof Map ? rs.get(key) : (has(rs, key) ? rs[key] : undefined);
};
const inChart = (inputs: Inputs, key: unknown): boolean => typeof key === 'string' && has(inputs.cards, key);
const cardLabel = (inputs: Inputs, key: unknown): string => (inChart(inputs, key) ? inputs.cards[key as string][1] : '');

// card(resource, resources) for a record in the chart: {ref, type, date, label, status}
export function card(key: string, inputs: Inputs): Card {
  const [date, label, status] = inputs.cards[key];
  return { ref: key, type: key.split('/')[0], date, label, status };
}

// --- label() for records the model wrote (request bodies), which are not in inputs.cards ---

function conceptText(value: unknown): string {
  if (typeof value === 'string') return strip(value);
  if (Array.isArray(value)) return [...new Set(value.map(conceptText).filter(Boolean))].join('; ');
  if (!isDict(value)) return '';
  if (typeof value.text === 'string' && strip(value.text)) return strip(value.text);
  if (has(value, 'family') || has(value, 'given')) {
    const given = has(value, 'given') ? pyIter(value.given) : [];
    return strip(pyJoin(' ', [...given, has(value, 'family') ? value.family : '']));
  }
  const codings = truthy(value.coding) ? pyIter(value.coding) : [value];
  for (const coding of codings) {
    if (isDict(coding) && (truthy(coding.display) || truthy(coding.code))) {
      return pyStr(truthy(coding.display) ? coding.display : coding.code);
    }
  }
  return '';
}

function quantityText(quantity: unknown): string {
  if (!isDict(quantity) || quantity.value === undefined || quantity.value === null) return '';
  const unit = [quantity.unit, quantity.code, quantity.currency].find(truthy);
  const comparator = has(quantity, 'comparator') ? pyStr(quantity.comparator) : '';
  return strip(`${comparator}${pyStr(quantity.value)} ${unit === undefined ? '' : pyStr(unit)}`);
}

function periodText(period: unknown): string {
  const start = pyGet(period, 'start'), end = pyGet(period, 'end');
  if (truthy(start) && truthy(end)) return `${pyStr(start)} – ${pyStr(end)}`;
  return truthy(start) ? `from ${pyStr(start)}` : truthy(end) ? `until ${pyStr(end)}` : '';
}

function rangeText(lowValue: unknown, highValue: unknown): string {
  const low = quantityText(lowValue);
  const high = quantityText(highValue);
  if (low && high) return `${low} – ${high}`;
  return low ? `≥ ${low}` : high ? `≤ ${high}` : '';
}

function valueText(record: JsonObject): string {
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith('value')) continue;
    if (isDict(value) && has(value, 'value')) return quantityText(value);
    if (isDict(value) && (has(value, 'low') || has(value, 'high'))) {
      return rangeText(pyGet(value, 'low'), pyGet(value, 'high'));
    }
    if (isDict(value) && (has(value, 'start') || has(value, 'end'))) return periodText(value);
    if (isDict(value) || Array.isArray(value)) return conceptText(value);
    return typeof value === 'boolean' ? String(value) : pyStr(value);
  }
  if (truthy(record.dataAbsentReason)) return 'no value: ' + conceptText(record.dataAbsentReason);
  const parts = pyIter(truthy(record.component) ? record.component : []).filter(isDict)
    .map((c) => strip(`${conceptText(pyGet(c, 'code'))} ${valueText(c)}`));
  return parts.filter(Boolean).join('; ');
}

function encounterClass(encounter: unknown): string {
  const value = pyGet(encounter, 'class');
  const code = isDict(value) ? hashable(pyGet(value, 'code')) : null;
  return (typeof code === 'string' && has(ENCOUNTER_CLASSES, code) ? ENCOUNTER_CLASSES[code] : '') || conceptText(value);
}

// The medication's name, or the reference as given (Python's `target or ''`).
function medicationName(resource: JsonObject, inputs: Inputs): unknown {
  if (truthy(resource.medicationCodeableConcept)) return conceptText(resource.medicationCodeableConcept);
  const target = hashable(pyGet(truthy(resource.medicationReference) ? resource.medicationReference : {}, 'reference'));
  const medication = typeof target === 'string' ? resourceOf(inputs, target) : undefined;
  return truthy(medication) ? conceptText(pyGet(medication, 'code')) : (truthy(target) ? target : '');
}

function party(value: unknown, inputs: Inputs): unknown {
  if (!isDict(value)) return pyStr(value);
  const key = hashable(pyGet(value, 'reference'));
  const name = cardLabel(inputs, key);
  return [name, pyGet(value, 'display'), pyGet(value, 'reference')].find(truthy) ?? '';
}

function label(value: unknown, inputs: Inputs): string {
  if (!has(value, 'resourceType')) throw new TypeError('KeyError: resourceType');
  const resource = value as JsonObject;  // a JSON object: only those carry own keys
  const kind = resource.resourceType;
  const get = (key: string): unknown => pyGet(resource, key);
  let text: unknown = '';
  if (kind === 'Observation') {
    const name = conceptText(get('code')), value = valueText(resource);
    text = name && value ? `${name}: ${value}` : name || value;
  } else if (kind === 'Encounter') {
    const parts = [encounterClass(resource), conceptText(get('type')), conceptText(get('reasonCode'))];
    text = parts.filter(Boolean).join(' · ');
  } else if (typeof kind !== 'string') {
    throw new TypeError("'startswith' of a non-string");
  } else if (kind.startsWith('Medication') && kind !== 'Medication') {
    text = medicationName(resource, inputs);
  } else if (kind === 'DocumentReference') {
    const titles = pyIter(truthy(get('content')) ? get('content') : [])
      .map((c) => pyGet(truthy(pyGet(c, 'attachment')) ? (c as JsonObject).attachment : {}, 'title'));  // pyGet threw off dicts
    text = [get('description'), conceptText(get('type'))].find(truthy) ?? conceptText(titles);
  } else if (kind === 'Communication') {
    const payload = pyIter(truthy(get('payload')) ? get('payload') : []);
    text = conceptText(payload.map((p) => pyGet(p, 'contentString', '')));
  } else if (kind === 'Provenance') {
    const count = [...references(get('target'))].length;
    const activity = conceptText(get('activity')) || 'provenance';
    text = `${activity} · ${count} target${count === 1 ? '' : 's'}`;
  } else if (kind === 'PractitionerRole') {
    text = pyJoin(' · ', [get('practitioner'), get('organization')].filter(truthy).map((p) => party(p, inputs)));
  } else if (kind === 'Coverage') {
    const payors = pyIter(truthy(get('payor')) ? get('payor') : []).map((p) => party(p, inputs));
    text = conceptText(get('type')) || conceptText(payors);
  }
  for (const field of LABEL_FIELDS) if (!truthy(text)) text = conceptText(get(field));
  return cpSlice(squash(pyStr(text)), LABEL_CHARS);
}

// safe_label(resource, resources): label() of any dict, '' where Python would raise.
// Records in the chart use their precomputed card label (key given).
export function safeLabel(resource: unknown, inputs: Inputs, key: string | null = null): string {
  if (key !== null && inChart(inputs, key)) return cardLabel(inputs, key);
  try { return label(resource, inputs); } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) return '';
    throw e;
  }
}

// --- Runs in plain words ---------------------------------------------------------------------

const NUM = '\\p{Nd}';
const DATE_BODY = `${NUM}{4}-${NUM}{2}-${NUM}{2}(?:T[${NUM}:.]+(?:Z|[+-]${NUM}{2}:${NUM}{2})?)?`;
const DATE_TEXT = new RegExp(`${B}${DATE_BODY}${B}`, 'gu');
const DATE_FULL = new RegExp(`^${B}${DATE_BODY}${B}$`, 'u');
const NUMBER_TEXT = new RegExp(`(?<![\\p{L}\\p{N}_.])-?${NUM}+(?:\\.${NUM}+)?(?![\\p{L}\\p{N}_.])`, 'gu');
const REF_TEXT = new RegExp(`(?<!${W})[A-Z][A-Za-z]+/[A-Za-z0-9\\-.]{1,64}`, 'gu');
const DIGIT = /\p{Nd}/u;
const SEARCH_DATE = new RegExp(`^(eq|ne|gt|ge|lt|le|sa|eb)?(${NUM}{4}-${NUM}{2}-${NUM}{2}[^\\n]*)$`, 'u');
const EMPTY_ANSWERS = new Set(['', 'none', 'none found', 'not found', 'nothing found', 'unknown',
  'n/a', 'not available', 'not documented', 'no data', 'no records']);
const NAME_FIELDS = new Set(['text', 'display', 'description', 'title', 'name', 'conclusion',
  'contentString', 'detail', 'comment', 'valueString', 'family']);
const PLUMBING = new Set(['reference', 'system', 'url', 'div', 'id', 'versionId', 'profile']);
const DATE_PREFIXES: Record<string, string> = { eq: 'on', ne: 'not on', gt: 'after', ge: 'on or after', lt: 'before',
  le: 'on or before', sa: 'after', eb: 'before' };
const FAILURES: Record<number, string> = {
  403: 'not allowed in this chart',
  404: 'not found',
  409: 'not saved: other records still point to it',
  412: 'not saved: the record changed since it was read, or no version was sent',
  429: 'not run: the request limit for this question was reached',
};
const WRITES: Record<string, string> = { POST: 'Created', PUT: 'Updated', DELETE: 'Deleted' };
const ATTEMPTS: Record<string, string> = { POST: 'create', PUT: 'update', DELETE: 'delete' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// float() of a decimal string, any Unicode digits.
function pyFloat(text: string): number {
  return Number(text.replace(/\p{Nd}/gu, (d) => {
    let start = d.codePointAt(0)!;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((d.codePointAt(0)! - start) % 10);
  }));
}

export function clip(value: unknown, chars = 160): string {
  const text = squash(pyStr(value));
  return cpLen(text) <= chars ? text : cpSlice(text, chars - 1) + '…';
}

export function dateWords(value: unknown): string {
  const text = pyStr(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cpSlice(text, 10));
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]) return `${MONTHS[mo - 1]} ${d}, ${y}`;
  }
  return text;
}

const rsplitLast = (v: string, sep: string): string => v.slice(v.lastIndexOf(sep) + 1);  // v.rsplit(sep, 1)[-1]

function codeWords(value: string, names: Record<string, string>): string {
  const code = rsplitLast(value, '|');
  const name = has(names, code) ? names[code] : null;
  return name && name.toLowerCase() !== code.toLowerCase() ? `${name} (${code})` : code;
}

function searchWords(key: string, value: string, patient: TracePatient, inputs: Inputs): string {
  const name = key.split(':')[0];
  const values = value.split(',').filter(Boolean);
  if (['patient', 'subject', 'beneficiary'].includes(name) && values.every((v) => v === patient.id || v === patient.ref)) {
    return '';
  }
  if (['patient', 'subject'].includes(name.split('.')[0]) && name.includes('.')) return '';
  if (name.startsWith('_')) {
    const words: Record<string, string> = {
      _sort: value.startsWith('-') ? 'newest first' : 'oldest first',
      _count: `at most ${value}`,
      _page: `page ${value}`,
      _include: 'with the records they link to',
      _id: 'by record id',
    };
    return has(words, name) ? words[name] : `${name} ${value}`;
  }
  if (name === 'identifier') return 'by identifier ' + values.map((v) => rsplitLast(v, '|')).join(' or ');
  if (name.includes('date') || ['authored', 'issued', 'period', 'sent', 'onset'].includes(name)) {
    const words: string[] = [];
    for (const v of values) {
      const m = SEARCH_DATE.exec(v);
      if (m) words.push(`${DATE_PREFIXES[m[1] || 'eq']} ${dateWords(m[2])}`);
    }
    return words.length ? 'dated ' + words.join(' or ') : `${name} ${value}`;
  }
  if (name.includes('status')) {
    return 'with status ' + values.map((v) => rsplitLast(v, '|').replaceAll('-', ' ')).join(' or ');
  }
  if (values.length && values.every((v) => REF_PATTERN.test(v))) {
    const kinds = new Set(values.map((v) => v.split('/')[0]));
    if (values.length === 1) {
      const title = inChart(inputs, values[0]) ? cardLabel(inputs, values[0]) : '';
      return `linked to ${noun([...kinds][0])} ${title ? `“${title}”` : values[0]}`;
    }
    const many = kinds.size === 1 ? noun([...kinds][0], true) : 'records';
    return `linked to ${values.length} ${many}`;
  }
  const shown = values.map((v) => codeWords(v, inputs.names)).join(' or ');
  if (name === 'code') return `for ${shown}`;
  return `with ${name.replaceAll('-', ' ')} ${shown}`;
}

// urllib.parse.parse_qsl(query, keep_blank_values=True)
function parseQsl(query: string): [string, string][] {
  const unquote = (s: string): string => s.replace(/\+/g, ' ').replace(/(%[0-9A-Fa-f]{2})+/g, (run) => new TextDecoder()
    .decode(new Uint8Array(run.slice(1).split('%').map((h) => parseInt(h, 16)))));
  const pairs: [string, string][] = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    pairs.push(i < 0 ? [unquote(part), ''] : [unquote(part.slice(0, i)), unquote(part.slice(i + 1))]);
  }
  return pairs;
}

const pyUpper = (v: unknown): string => pyStr(v).toUpperCase();
function pyTitle(s: string): string {
  let out = '', prev = false;
  for (const ch of s) {
    const cased = ch.toLowerCase() !== ch.toUpperCase();
    out += cased ? (prev ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    prev = cased;
  }
  return out;
}

// request_words(arguments, patient, names, resources, refused): what one fhir_request asked.
// patient is the ChartIndex patient dict ({id, ref, ...}).
export function requestWords(args: unknown, patient: TracePatient, inputs: Inputs, refused = false): string {
  if (!isDict(args)) return 'Sent a request the tool could not read';
  const method = truthy(args.method) ? pyUpper(args.method) : '';
  const path = truthy(args.path) ? strip(pyStr(args.path)).replace(/^\/+/, '') : '';
  const q = path.indexOf('?');
  const target = q < 0 ? path : path.slice(0, q), query = q < 0 ? '' : path.slice(q + 1);
  const kind = target.split('/')[0];
  const body = has(args, 'body') ? args.body : null;
  if (method === 'GET' && target === 'metadata') return 'Checked which searches the chart supports';
  const tried = refused ? 'Tried to ' : '';
  if (method === 'POST' && !target) {
    const entries = isDict(body) && has(body, 'entry') ? body.entry : null;
    const count = Array.isArray(entries) ? entries.length : 0;
    const changes = `${count} change${count === 1 ? '' : 's'} in one transaction`;
    return refused ? `${tried}save ${changes}` : `Saved ${changes}`;
  }
  if (target.includes('/') && !query) {
    const title = inChart(inputs, target) ? cardLabel(inputs, target) : '';
    const named = title ? `${noun(kind)} “${title}”` : `${noun(kind)} ${target}`;
    if (method === 'GET') return target === patient.ref ? "Opened the patient's record" : `Opened ${named}`;
    if (refused) return `Tried to ${has(ATTEMPTS, method) ? ATTEMPTS[method] : (method.toLowerCase() || 'send')} ${named}`;
    return `${has(WRITES, method) ? WRITES[method] : (pyTitle(method) || 'Sent')} ${named}`;
  }
  if (method === 'POST' && target) {
    const title = isDict(body) ? safeLabel(body, inputs) : '';
    const article = 'aeiou'.includes(noun(kind).slice(0, 1)) ? 'an' : 'a';
    const what = `${article} ${noun(kind)}` + (title ? ` “${title}”` : '');
    return refused ? `${tried}create ${what}` : `Created ${what}`;
  }
  if (method === 'GET' && target) {
    const params = parseQsl(query);
    const mrn = params.filter(([k, v]) => k === 'identifier' && v.startsWith(MRN_SYSTEM + '|')).map(([, v]) => rsplitLast(v, '|'));
    if (kind === 'Patient' && mrn.length) return `Looked up the patient by MRN ${mrn[0]}`;
    const words = params.map(([k, v]) => searchWords(k, v, patient, inputs)).filter(Boolean).join(', ');
    return `Searched ${noun(kind, true)}` + (words ? ` ${words}` : '');
  }
  return `Sent ${method} ${path || '(root)'}`;
}

// outcome_words(method, status, content): how the chart answered one request.
export function outcomeWords(method: string, status: Status | undefined, content: string): string {
  if (status === null || status === undefined) {
    const first = firstLine(content);
    return 'not run: ' + clip(first.startsWith('error: ') ? first.slice(7) : first);
  }
  let body: unknown = null;
  try {
    const result = pyLoads(content);
    if (isDict(result)) body = has(result, 'body') ? result.body : null;
  } catch (e) { if (!(e instanceof JSONError)) throw e; }
  if (status >= 400) {
    const issues = isDict(body) && has(body, 'issue') ? body.issue : null;
    const detail = pyIter(truthy(issues) ? issues : []).filter(isDict)
      .map((issue) => (truthy(issue.diagnostics) ? pyStr(issue.diagnostics) : '')).join('; ');
    const reason = has(FAILURES, status) ? FAILURES[status] : 'the chart could not run it';
    return detail && (status === 400 || status === 403) ? `${reason}: ${clip(detail)}` : reason;
  }
  if (isDict(body) && body.type === 'searchset') {
    const total = has(body, 'total') ? body.total : pyIter(truthy(body.entry) ? body.entry : []).length;
    return truthy(total) ? `found ${pyStr(total)}` : 'found none';
  }
  if (isDict(body) && body.type === 'transaction-response') return 'saved';
  return ({ POST: 'created', PUT: 'saved', DELETE: 'deleted' } as Record<string, string | undefined>)[method] ?? '';
}

// One tool step's explanation fields, as run_agent computes them for a fhir_request call:
// {status, summary, refs (all, not capped), plain, outcome, write, error}.
export function toolStepWords(args: unknown, content: string, patient: TracePatient, inputs: Inputs): ToolStepWords {
  const [status, summary, refs] = describeResult(content);
  const method = isDict(args) && truthy(args.method) ? pyUpper(args.method) : '';
  const error = status === null || status >= 400;
  const write = has(WRITES, method);
  return {
    status, summary, refs,
    plain: requestWords(args, patient, inputs, error && write),
    outcome: outcomeWords(method, status, content),
    write, error,
  };
}

// --- Sources, claims and verification -----------------------------------------------------

const keysOf = (m: Retrieved): string[] => (m instanceof Map ? [...m.keys()] : Object.keys(m));
const valueOf = (m: Retrieved, k: string): number[] | undefined => (m instanceof Map ? m.get(k) : has(m, k) ? m[k] : undefined);
const hasKey = (m: Retrieved, k: string): boolean => (m instanceof Map ? m.has(k) : has(m, k));

// run_sources(session, retrieved, cited, gold): retrieved maps references to call numbers
// (a Map or an object, in first-seen order); gold is null outside a compiled task.
// Rows come in retrieved, cited, gold order. (Python lists cited-only rows in set order,
// which varies with the hash seed; here they keep the evidence order.) The patient argument
// is unused, as in Python.
export function runSources(
  retrieved: Retrieved, cited: string[], gold: string[] | null | undefined, inputs: Inputs,
  _patient: TracePatient | null = null,
): SourceRow[] {
  const citedSet = new Set(cited), golden = new Set(gold || []);
  const rows: SourceRow[] = [];
  for (const key of new Set([...keysOf(retrieved), ...cited, ...(gold || [])])) {
    const exists = inChart(inputs, key);
    const row: Card = exists ? card(key, inputs)
      : { ref: key, type: key.includes('/') ? key.split('/')[0] : null, date: null, label: '', status: '' };
    rows.push({
      ...row,
      exists,
      calls: valueOf(retrieved, key) ?? [],
      cited: citedSet.has(key),
      gold: gold === null || gold === undefined ? null : golden.has(key),
    });
  }
  return rows;
}

// answer_shown(parsed, text)
export function answerShown(parsed: unknown, text: string): unknown {
  if (isDict(parsed)) {
    if (has(parsed, 'answer')) return parsed.answer;
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(parsed)) if (k !== 'evidence') setKey(out, k, v);
    return out;
  }
  return text;
}

// answer_entries(answer) -> [[path], value]
export function answerEntries(answer: unknown): [AnswerPath, unknown][] {
  if (Array.isArray(answer)) return answer.map((item, i): [AnswerPath, unknown] => [[i], item]);
  if (isDict(answer)) {
    const rows: [AnswerPath, unknown][] = [];
    for (const [key, value] of Object.entries(answer)) {
      if (Array.isArray(value)) value.forEach((item, i) => rows.push([[key, i], item]));
      else rows.push([[key], value]);
    }
    return rows;
  }
  return [[[], answer]];
}

// leaves(value): every scalar in it but null and booleans, in order.
export function leaves(value: unknown, out: unknown[] = []): unknown[] {
  if (isDict(value)) for (const item of Object.values(value)) leaves(item, out);
  else if (Array.isArray(value)) for (const item of value) leaves(item, out);
  else if (value !== null && value !== undefined && typeof value !== 'boolean') out.push(value);
  return out;
}

// stated(value) -> {refs, dates, numbers, texts} (Sets)
export function stated(value: unknown): Stated {
  const refs = new Set<string>(), dates = new Set<string>(), numbers = new Set<number>(), texts = new Set<string>();
  for (const leaf of leaves(value)) {
    if (numeric(leaf)) { numbers.add(Number(leaf)); continue; }
    const text = strip(pyStr(leaf));
    if (REF_PATTERN.test(text)) refs.add(text);
    else if (DATE_FULL.test(text)) dates.add(text.slice(0, 10));
    else if (cpLen(text) > 40 || (text.includes(' ') && DIGIT.test(text))) {
      for (const m of text.match(REF_TEXT) || []) refs.add(m);
      for (const m of text.match(DATE_TEXT) || []) dates.add(m.slice(0, 10));
      const rest = text.replace(REF_TEXT, ' ').replace(DATE_TEXT, ' ');
      for (const m of rest.match(NUMBER_TEXT) || []) numbers.add(pyFloat(m));
      texts.add(text.toLowerCase());
    } else if (text) texts.add(text.toLowerCase());
  }
  return { refs, dates, numbers, texts };
}

// record_terms(resource, resources) -> {dates: Set, numbers: Set, texts: Map text -> weight}
// for a record in the chart (needs inputs.resources).
export function recordTerms(key: string, inputs: Inputs): RecordTerms {
  const dates = new Set<string>(), numbers = new Set<number>(), texts = new Map<string, number>();
  const add = (raw: string, weight: number): void => {
    const text = squash(raw).toLowerCase();
    if (text && cpLen(text) <= 300) texts.set(text, Math.max(texts.get(text) ?? 0, weight));
  };
  const walk = (value: unknown, key: string): void => {
    if (isDict(value)) {
      if (numeric(value.value) && has(value, 'value')) numbers.add(Number(value.value));
      for (const [child, item] of Object.entries(value)) if (child !== 'meta') walk(item, child);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    } else if (typeof value === 'string' && !PLUMBING.has(key)) {
      if (DATE_FULL.test(strip(value))) dates.add(strip(value).slice(0, 10));
      else add(value, NAME_FIELDS.has(key) || (cpLen(value) > 5 && DIGIT.test(value)) ? 1 : 0.5);
    }
  };
  walk(resourceOf(inputs, key), '');
  add(cardLabel(inputs, key), 1);
  return { dates, numbers, texts };
}

// match_score(claim, key, terms). Python adds None (a TypeError) for a text of 3 characters
// or fewer that the record does not state exactly; here it adds 0.
/** contains_token(haystack, needle): needle in haystack, not inside a longer word ("g/dl" is not in "mg/dl"). */
export function containsToken(haystack: string, needle: string): boolean {
  const literal = needle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');  // '-' is literal outside a class
  return new RegExp(`(?<!${W})${literal}(?!${W})`, 'u').test(haystack);
}

export function matchScore(claim: Stated, key: string, terms: RecordTerms): number {
  let score = claim.refs.has(key) ? 3.0 : 0.0;
  for (const d of claim.dates) if (terms.dates.has(d)) score += 2;
  for (const n of claim.numbers) if ([...terms.numbers].some((m) => Math.abs(n - m) < 1e-9)) score += 2;
  for (const text of claim.texts) {
    let weight = terms.texts.get(text);
    if (weight === undefined && cpLen(text) > 3) {
      weight = 0;
      for (const [t, w] of terms.texts) {
        if (cpLen(t) > 3 && (containsToken(t, text) || containsToken(text, t))) weight = Math.max(weight, w);
      }
    }
    score += weight ?? 0;
  }
  return score;
}

// answer_claims(answer, cited, retrieved, resources): for each part of the answer, the
// records that state it. retrieved as in runSources.
export function answerClaims(answer: unknown, cited: string[], retrieved: Retrieved, inputs: Inputs): Claim[] {
  const citedSet = new Set(cited);
  const pools = [
    [...new Set(cited)].filter((key) => inChart(inputs, key)),
    keysOf(retrieved).filter((key) => inChart(inputs, key) && !citedSet.has(key)),
  ];
  const terms = new Map<string, RecordTerms>(), claims: Claim[] = [];
  for (const [path, value] of answerEntries(answer)) {
    const claim = stated(value);
    const any = claim.refs.size || claim.dates.size || claim.numbers.size || claim.texts.size;
    let found: string[] = [], fromCited: boolean | null = null;
    for (const [p, pool] of pools.entries()) {
      if (!any) break;
      const scores = new Map<string, number>();
      for (const key of pool) {
        if (!terms.has(key)) terms.set(key, recordTerms(key, inputs));
        scores.set(key, matchScore(claim, key, terms.get(key)!));
      }
      // A cited record needs less: an exact plain match (0.5) is enough there.
      const need = p === 0 ? 0.5 : 1;
      const best = Math.max(0, ...scores.values());
      if (best >= need) {
        const floor = Math.max(need, best * 0.6);
        found = [...scores].filter(([, s]) => s >= floor).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
        fromCited = p === 0;
        break;
      }
    }
    if (!found.length) {
      found = [...claim.refs].filter((k) => inChart(inputs, k)).sort().slice(0, 4);
      fromCited = found.length ? false : null;
    }
    claims.push({ path, sources: found, cited: fromCited });
  }
  return claims;
}

// is_empty(value): whether an answer says nothing was found.
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return EMPTY_ANSWERS.has(strip(value).replace(/\.+$/, '').toLowerCase());
  if (isDict(value)) return Object.values(value).every(isEmpty);
  if (Array.isArray(value)) return value.every(isEmpty);
  return false;
}

// verification(final, retrieved, resources, patient): patientRef is "Patient/<id>".
export function verification(
  final: FinalAnswer | null | undefined, retrieved: Retrieved, inputs: Inputs, patientRef: string,
): Verification {
  const result: Verification = { state: 'none', supporting: [], unchecked: [], patient: false };
  if (final === null || final === undefined) return result;
  const cited = [...new Set(final.evidence)];
  for (const key of cited) {
    if (!inChart(inputs, key)) result.unchecked.push({ ref: key, reason: 'not in this chart' });
    else if (!hasKey(retrieved, key)) result.unchecked.push({ ref: key, reason: 'not read in this run' });
  }
  const read = cited.filter((key) => inChart(inputs, key) && hasKey(retrieved, key));
  const matched = new Set((final.claims || []).flatMap((claim) => claim.sources));
  result.supporting = read.filter((key) => key !== patientRef || matched.has(key));
  result.patient = read.includes(patientRef);
  if (final.parsed === null) result.state = 'unreadable';
  else if (isEmpty(final.shown)) result.state = 'not_found';
  else if (result.supporting.length) result.state = result.unchecked.length ? 'partial' : 'verified';
  else result.state = 'unsupported';
  return result;
}

// run_agent's tail: trace.final.claims and .names, sources, verification, refused_changes
// and changes (none: writes are refused in the browser). task is compiled_task's result or
// null; patient the ChartIndex patient dict. Returns trace.
export function finishTrace<T extends Trace>(
  trace: T, retrieved: Retrieved, inputs: Inputs, patient: TracePatient, task: TraceTask | null = null,
): T {
  const final = trace.final;
  const cited = final ? final.evidence : [];
  const gold = task ? task.gold : null;
  trace.changes = [];
  trace.sandbox_changes = 0;
  trace.sources = runSources(retrieved, cited, gold, inputs, patient);
  if (final) {
    final.claims = answerClaims(final.shown, cited, retrieved, inputs);
    const names: Record<string, string> = {};
    for (const leaf of leaves(final.shown)) {
      if (typeof leaf === 'string' && has(inputs.names, leaf)) setKey(names, leaf, inputs.names[leaf]);
    }
    final.names = names;
  }
  trace.verification = verification(final, retrieved, inputs, patient.ref);
  trace.refused_changes = trace.steps
    .filter((step): step is ToolStep => step.type === 'tool' && step.write && step.error)
    .map((step) => ({ call: step.call, plain: step.plain, outcome: step.outcome, status: step.status }));
  return trace;
}


// --- What a run changed (demo/app.py's change_view and what it reads) --------------------------
//
// tests/trace-changes.test.ts checks changeView against Python on real audit entries. One
// difference from Python, kept on purpose: a referenced record's name inside party() comes from
// inputs.cards (the chart as loaded), where Python recomputes it from the sandbox copy; they
// differ only when a write changed that very record.

const EXTERNAL = ['http:', 'https:', 'urn:', '#'];
const CODING = new Set(['system', 'version', 'code', 'display', 'userSelected']);
const FACTS_FIRST = ['title', 'description', 'code', 'type', 'category', 'class', 'status', 'docStatus', 'intent',
  'clinicalStatus', 'verificationStatus', 'date', 'effectiveDateTime', 'issued', 'authoredOn', 'period', 'subject',
  'patient', 'for', 'encounter', 'context', 'author'];
const FACTS_SKIP = new Set(['resourceType', 'id', 'meta', 'text', 'contained', 'extension', 'modifierExtension',
  'implicitRules', 'language', 'content', 'presentedForm', 'section', 'component']);
const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  clinicalStatus: 'Clinical status',
  verificationStatus: 'Verification',
  lifecycleStatus: 'Status',
  docStatus: 'Document status',
  statusReason: 'Status reason',
  code: 'Code',
  category: 'Category',
  type: 'Type',
  class: 'Visit class',
  intent: 'Intent',
  priority: 'Priority',
  subject: 'Patient',
  patient: 'Patient',
  for: 'Patient',
  beneficiary: 'Patient',
  encounter: 'Visit',
  'context.encounter': 'Visit',
  effectiveDateTime: 'Date',
  effectiveInstant: 'Date',
  effectivePeriod: 'Period',
  occurrenceDateTime: 'Date',
  performedDateTime: 'Performed',
  performedPeriod: 'Performed',
  issued: 'Issued',
  authoredOn: 'Ordered',
  date: 'Date',
  dateTime: 'Date',
  period: 'Period',
  start: 'Start',
  end: 'End',
  created: 'Created',
  started: 'Started',
  recorded: 'Recorded',
  recordedDate: 'Recorded',
  onsetDateTime: 'Onset',
  abatementDateTime: 'Resolved',
  sent: 'Sent',
  received: 'Received',
  receivedTime: 'Received',
  identifiedDateTime: 'Identified',
  whenPrepared: 'Prepared',
  whenHandedOver: 'Handed over',
  performer: 'Performed by',
  requester: 'Ordered by',
  author: 'Author',
  recorder: 'Recorded by',
  asserter: 'Reported by',
  resultsInterpreter: 'Interpreted by',
  valueQuantity: 'Value',
  valueCodeableConcept: 'Value',
  valueString: 'Value',
  valueBoolean: 'Value',
  valueInteger: 'Value',
  valueDateTime: 'Value',
  dataAbsentReason: 'Missing value',
  interpretation: 'Interpretation',
  referenceRange: 'Reference range',
  conclusion: 'Conclusion',
  note: 'Note',
  description: 'Description',
  title: 'Title',
  reasonCode: 'Reason',
  reasonReference: 'Reason',
  basedOn: 'Based on',
  partOf: 'Part of',
  result: 'Result',
  hasMember: 'Panel member',
  derivedFrom: 'Derived from',
  specimen: 'Specimen',
  imagingStudy: 'Imaging study',
  medicationCodeableConcept: 'Medication',
  medicationReference: 'Medication',
  dosageInstruction: 'Dose',
  dosage: 'Dose',
  dispenseRequest: 'Dispense request',
  authorizingPrescription: 'Prescription',
  request: 'Order',
  quantity: 'Quantity',
  daysSupply: 'Days supply',
  participant: 'Participant',
  'participant.actor': 'Participant',
  'participant.member': 'Member',
  serviceType: 'Service',
  appointmentType: 'Appointment type',
  slot: 'Slot',
  schedule: 'Schedule',
  payor: 'Payer',
  subscriberId: 'Subscriber ID',
  identifier: 'Identifier',
  focus: 'About',
  about: 'About',
  owner: 'Owner',
  payload: 'Message',
  recipient: 'Recipient',
  sender: 'Sender',
  location: 'Location',
  'location.location': 'Location',
  serviceProvider: 'Facility',
  managingOrganization: 'Organization',
  generalPractitioner: 'Primary care',
  name: 'Name',
  telecom: 'Contact',
  gender: 'Sex',
  birthDate: 'Date of birth',
  address: 'Address',
  active: 'Active',
  criticality: 'Criticality',
  reaction: 'Reaction',
  target: 'Target',
  'agent.who': 'Recorded by',
  activity: 'Activity',
  goal: 'Goal',
  addresses: 'Addresses',
  'entry.item': 'Entry',
  implicated: 'Concerns',
  detail: 'Detail',
  policyRule: 'Policy',
  scope: 'Scope'
};

/** field_label(path): context.encounter -> Visit. */
export function fieldLabel(path: string): string {
  if (!path) return '';
  const last = path.slice(path.lastIndexOf('.') + 1);
  if (has(FIELD_LABELS, path) || has(FIELD_LABELS, last)) return FIELD_LABELS[path] || FIELD_LABELS[last];
  const words = last.replace(/(?<=[a-z])(?=[A-Z])/g, ' ').toLowerCase();
  return words.slice(0, 1).toUpperCase() + words.slice(1);
}

/** status_text(resource). */
export function statusText(resource: JsonObject): string {
  for (const field of ['status', 'clinicalStatus', 'lifecycleStatus']) {
    const text = conceptText(resource[field]);
    if (text) return text;
  }
  return typeof resource.active === 'boolean' ? (resource.active ? 'active' : 'inactive') : '';
}

/** record_date(resource): the store's date sort key, else a display-only fallback. */
export function recordDate(resource: JsonObject): string | null {
  const collection = resource.collection;
  const candidates: unknown[] = [resource_date(resource), resource.onsetDateTime, resource.recordedDate,
    isDict(collection) ? collection.collectedDateTime : null, resource.receivedTime, resource.created];
  for (const value of candidates) if (truthy(value)) return pyStr(value);
  return null;
}

/** A row's text (datatype_text): a primitive or a common FHIR datatype; null for other structures. */
export function datatypeText(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string' || numeric(value)) return pyStr(value);
  if (!isDict(value)) return null;
  const keys = Object.keys(value).filter((k) => k !== 'id' && k !== 'extension');
  const within = (allowed: ReadonlySet<string>): boolean => keys.length > 0 && keys.every((k) => allowed.has(k));
  const number = value.value;
  if (numeric(number)) return quantityText(value);  // Quantity, Age, Duration, Money
  if (within(new Set(['start', 'end']))) return periodText(value);
  if (within(new Set(['low', 'high', 'text', 'type', 'appliesTo', 'age']))) {
    return truthy(value.text) ? (value.text as string) : rangeText(value.low, value.high);
  }
  if (has(value, 'coding') || (keys.length === 1 && keys[0] === 'text') || has(value, 'family') || has(value, 'given')) {
    return conceptText(value);  // CodeableConcept, HumanName
  }
  if (has(value, 'code') && within(CODING)) return conceptText(value);  // Coding
  if (has(value, 'reference') || (has(value, 'display') && within(new Set(['display', 'type'])))) {
    const shown = truthy(value.display) ? value.display : value.reference;
    return typeof shown === 'string' ? shown : null;
  }
  if (typeof number === 'string') return number;  // Identifier, ContactPoint
  for (const key of ['text', 'contentString']) if (typeof value[key] === 'string') return value[key] as string;
  return null;
}

/** One end of a reference: the field it sits in and the record it names, if any (link_row). */
export interface LinkRow {
  path: string | null;
  relation: string | null;
  ref: string;
  type?: string | null;
  date?: string | null;
  label?: string;
  status?: string;
  exists: boolean;
}

export function linkRow(path: string | null, target: string, inputs: Inputs): LinkRow {
  const resource = resourceOf(inputs, target);
  const relation = (path ? fieldLabel(path) : '') || null;
  if (!isDict(resource)) {
    const kind = EXTERNAL.some((p) => target.startsWith(p)) ? null : target.split('/')[0];
    return { path, relation, ref: target, type: kind, exists: false };
  }
  return {
    path, relation, ref: target, type: pyStr(resource.resourceType), date: recordDate(resource),
    label: safeLabel(resource, inputs), status: statusText(resource), exists: true,
  };
}

export type FactText = { text: string; refs?: undefined } | { refs: LinkRow[]; text?: undefined };

/** describe(value, resources): a field as {text} or {refs}; null for structures left to the JSON view. */
export function describeField(value: unknown, inputs: Inputs): FactText | null {
  const items = Array.isArray(value) ? value : [value];
  if (!items.length) return null;
  if (items.every((v) => isDict(v) && typeof v.reference === 'string')) {
    return { refs: items.map((v) => linkRow(null, (v as JsonObject).reference as string, inputs)) };
  }
  const texts = items.map(datatypeText);
  if (texts.some((t) => t === null)) return null;
  const text = (texts as string[]).filter(Boolean).join('; ');
  return text ? { text } : null;
}

export type Fact = ({ field: string; label: string } & FactText);

/** facts(resource, resources): top-level fields (and one level of plain nesting) as text or reference lists. */
export function facts(resource: JsonObject, inputs: Inputs, skip: readonly string[] = []): Fact[] {
  const rows: Fact[] = [];
  const keys = [...FACTS_FIRST.filter((k) => has(resource, k)), ...Object.keys(resource).filter((k) => !FACTS_FIRST.includes(k))];
  for (const key of keys) {
    if (FACTS_SKIP.has(key) || skip.includes(key) || key.startsWith('_')) continue;
    const value = resource[key];
    const fact = describeField(value, inputs);
    if (fact) rows.push({ field: key, label: fieldLabel(key), ...fact } as Fact);
    else if (isDict(value)) {  // a backbone element such as context or collection: one level down
      for (const [child, item] of Object.entries(value)) {
        const nested = describeField(item, inputs);
        if (nested) rows.push({ field: `${key}.${child}`, label: fieldLabel(`${key}.${child}`), ...nested } as Fact);
      }
    }
  }
  return rows;
}

/** field_words(value, resources): a field's value as short text, else compact JSON. */
export function fieldWords(value: unknown, inputs: Inputs): string | null {
  if (value === undefined || value === null) return null;
  const fact = describeField(value, inputs);
  if (fact && fact.refs) return fact.refs.map((row) => row.label || row.ref).join(', ');
  if (fact) return clip(fact.text);
  return clip(pyDumps(value));
}

/** An audit entry (FhirStore.audit): the write's method, the record and its states around it. */
export interface AuditLike { method: string; ref: string; before: JsonObject | null; after: JsonObject | null }

export interface ChangeField { field: string; label: string; before: string | null; after: string | null }
export interface ChangeView {
  method: string;
  ref: string;
  type: string;
  verb: string;
  noun: string;
  label: string;
  fields: ChangeField[];
  exists: boolean;
}

/** change_view(entry, resources): one sandbox write in plain words, field by field. inputs.resources is the store after the run. */
export function changeView(entry: AuditLike, inputs: Inputs): ChangeView {
  const { before, after } = entry;
  const record: JsonObject = (after && truthy(after) ? after : before && truthy(before) ? before : {});
  const kind = truthy(record.resourceType) ? pyStr(record.resourceType) : entry.ref.split('/')[0];
  const fields: ChangeField[] = [];
  if (!before && after) {  // created: what the new record says
    for (const fact of facts(after, inputs)) {
      if (['subject', 'patient', 'for', 'beneficiary'].includes(fact.field)) continue;
      const text = fact.text || (fact.refs ?? []).map((r) => r.label || r.ref).join(', ');
      fields.push({ field: fact.field, label: fact.label, before: null, after: clip(text) });
    }
  } else if (before && after) {
    const keys = FACTS_FIRST.filter((k) => has(before, k) || has(after, k));
    for (const k of Object.keys({ ...before, ...after })) if (!keys.includes(k)) keys.push(k);
    for (const key of keys) {
      if (FACTS_SKIP.has(key) || pyEq(before[key] ?? null, after[key] ?? null)) continue;
      fields.push({ field: key, label: fieldLabel(key), before: fieldWords(before[key], inputs), after: fieldWords(after[key], inputs) });
    }
  }
  return {
    method: entry.method, ref: entry.ref, type: kind, verb: WRITES[entry.method] ?? entry.method, noun: noun(kind),
    label: truthy(record) ? safeLabel(record, inputs) : '', fields: fields.slice(0, 10),
    exists: resourceOf(inputs, entry.ref) !== undefined,
  };
}
