// Port of fhir_query_rl/validation.py at bf9db15 (sha256 7748bd2d1b4ca8358afd90063fa793456c9ed26e3855514bcaebab3cfeefabe3)
//
// FHIR R4 shape and local graph checks; not full FHIRPath conformance. Messages are the ones
// Python raises, byte for byte (they reach the model in 400 responses).
import { pathString } from './jsonschema.ts';
import { pyParse } from './pyjson.ts';
import { schemaDefinitions, schemaValidator } from './envdata.ts';
import {
  AttributeError, KeyError, TypeError_, ValueError, clone, cmpStr, hasOwn, inStrings, isDict, iterate, pyCompare, pyRepr, pyStr,
  pyTypeName, sub, subscript, truthy, type Rec,
} from './pyrt.ts';

const JSON_INTEGER = /^-?(0|[1-9][0-9]*)$/;
const JSON_NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

/** The definition `resource_type` validates against; ValueError for an unknown type. */
function checkedType(resourceType: unknown): string {
  if (Array.isArray(resourceType) || isDict(resourceType)) throw new TypeError_(`unhashable type: '${pyTypeName(resourceType)}'`);
  if (typeof resourceType !== 'string' || !hasOwn(schemaDefinitions(), resourceType)) {
    throw new ValueError(`Unknown FHIR R4 resource type: ${pyStr(resourceType)}`);
  }
  return resourceType;
}

/** Python's dict.get(key, default) on something that must be a dict (AttributeError otherwise). */
export function pyGet(obj: unknown, key: string, fallback: unknown = null): unknown {
  if (!isDict(obj)) throw new AttributeError(`'${pyTypeName(obj)}' object has no attribute 'get'`);
  return hasOwn(obj, key) ? obj[key] : fallback;
}

export function validate_resource(resource: unknown): void {
  const kind = pyGet(resource, 'resourceType', '');
  const errors = schemaValidator().iterErrors(checkedType(kind), resource);
  errors.sort((a, b) => cmpStr(pathString(a.path), pathString(b.path)));
  if (errors.length) {
    throw new ValueError(errors.slice(0, 4).map((e) => `${pyRepr(e.path)}: ${e.message}`).join('; '));
  }
}

/** The JSON value a string spells for a schema type, or undefined if it spells none. */
function typed(text: string, kind: string): unknown {
  if (kind === 'boolean' && ['true', 'false'].includes(text.toLowerCase())) return text.toLowerCase() === 'true';
  if (kind === 'integer' && JSON_INTEGER.test(text)) return parseInt(text, 10) + 0;
  if (kind === 'number' && JSON_NUMBER.test(text)) return pyParse(text);
  return undefined;
}

/**
 * A copy with string-encoded numbers and booleans retyped where R4 requires it.
 *
 * Some chat templates serialize every tool-argument leaf as a string ("13.4", "true"), which
 * the schema rejects for reasons unrelated to FHIR skill. Only exact spellings of the required
 * type are converted; validate_resource still rejects everything else.
 */
export function coerce_typed_strings(resource: unknown): unknown {
  const copy = clone(resource);
  if (!isDict(copy) || typeof copy.resourceType !== 'string') return copy;
  if (!hasOwn(schemaDefinitions(), copy.resourceType)) return copy;
  for (let pass = 0; pass < 4; pass++) {  // nested choices can surface one level per pass
    let changed = false;
    for (const error of schemaValidator().iterErrors(copy.resourceType, copy)) {
      const path = error.path;
      if (
        error.validator !== 'type' ||
        !(error.validator_value === 'boolean' || error.validator_value === 'integer' || error.validator_value === 'number') ||
        typeof error.instance !== 'string' || !path.length
      ) continue;
      const value = typed(error.instance, error.validator_value);
      if (value === undefined) continue;
      let parent: unknown = copy;
      for (const key of path.slice(0, -1)) parent = (parent as Rec)[key];
      (parent as Rec)[path[path.length - 1]] = value;
      changed = true;
    }
    if (!changed) break;
  }
  return copy;
}

export function* references(value: unknown): Generator<string, void, undefined> {
  if (isDict(value)) {
    if (typeof value.reference === 'string') yield value.reference;
    for (const child of Object.values(value)) yield* references(child);
  } else if (Array.isArray(value)) {
    for (const child of value) yield* references(child);
  }
}

/** "Type/id" of a resource (KeyError when either part is missing, as in Python). */
export function ref(resource: unknown): string {
  return `${pyStr(subscript(resource, 'resourceType'))}/${pyStr(subscript(resource, 'id'))}`;
}

/** The one Patient a resource belongs to, or null; ValueError when it names several. */
export function patientRef(resource: unknown): string | null {
  if (subscript(resource, 'resourceType') === 'Patient') return ref(resource);
  const r = resource as Rec;
  const candidates = new Set<string>();
  const add = (v: unknown) => { for (const x of references(v)) if (x.startsWith('Patient/')) candidates.add(x); };
  for (const key of ['subject', 'patient', 'beneficiary', 'for']) add(pyGet(r, key));
  if (r.resourceType === 'Appointment') add(pyGet(r, 'participant'));
  if (r.resourceType === 'AppointmentResponse') add(pyGet(r, 'actor'));
  if (candidates.size > 1) throw new ValueError('Multi-patient resources are outside the benchmark write/search subset');
  return candidates.size ? [...candidates][0] : null;
}

function startsWith(value: unknown, prefix: string): boolean {
  if (typeof value !== 'string') throw new AttributeError(`'${pyTypeName(value)}' object has no attribute 'startswith'`);
  return value.startsWith(prefix);
}

const SLOT_BUSY = new Set(['busy', 'busy-tentative']);

/** Selected local workflow constraints; not a full FHIRPath validator. */
export function validate_workflow_graph(index: Map<string, Rec>): void {
  for (const resource of index.values()) {
    const kind = sub(resource, 'resourceType');
    if (kind === 'CareTeam') {
      for (const participant of iterate(pyGet(resource, 'participant', []))) {
        if (truthy(pyGet(participant, 'onBehalfOf')) && !startsWith(pyGet(pyGet(participant, 'member', {}), 'reference', ''), 'Practitioner/')) {
          throw new ValueError('CareTeam onBehalfOf requires a Practitioner member');
        }
      }
    }
    if (kind === 'List' && pyGet(resource, 'mode') !== 'working' && iterate(pyGet(resource, 'entry', [])).some((e) => truthy(pyGet(e, 'date')))) {
      throw new ValueError('List entry dates require working mode');
    }
    if (kind === 'Slot' || kind === 'Appointment') {
      const start = pyGet(resource, 'start'), end = pyGet(resource, 'end');
      if (truthy(start) !== truthy(end) || (truthy(start) && pyCompare('>=', start, end))) {
        throw new ValueError('Invalid appointment/slot interval');
      }
    }
    if (kind === 'Appointment' && pyGet(resource, 'status') === 'booked') {
      for (const slotRef of iterate(pyGet(resource, 'slot', []))) {
        const key = pyGet(slotRef, 'reference');
        if (Array.isArray(key) || isDict(key)) throw new TypeError_(`unhashable type: '${pyTypeName(key)}'`);
        const slot = (typeof key === 'string' ? index.get(key) : undefined) ?? {};
        if (!inStrings(pyGet(slot, 'status'), SLOT_BUSY)) throw new ValueError('Booked appointment requires reserved slot');
        if (pyCompare('<', pyGet(resource, 'start'), pyGet(slot, 'start', '')) || pyCompare('>', pyGet(resource, 'end'), pyGet(slot, 'end', ''))) {
          throw new ValueError('Appointment falls outside reserved slot');
        }
      }
    }
    if (kind === 'Observation') {
      if (truthy(pyGet(resource, 'dataAbsentReason')) && Object.keys(resource).some((k) => k.startsWith('value'))) {
        throw new ValueError('Observation cannot have a value and dataAbsentReason');
      }
    }
    if (kind === 'Immunization') {
      if (truthy(pyGet(resource, 'occurrenceDateTime')) === truthy(pyGet(resource, 'occurrenceString'))) {
        throw new ValueError('Immunization requires exactly one occurrence choice');
      }
    }
    if (kind === 'MedicationDispense') {
      if (truthy(pyGet(resource, 'whenPrepared')) && truthy(pyGet(resource, 'whenHandedOver')) &&
        pyCompare('>', sub(resource, 'whenPrepared'), sub(resource, 'whenHandedOver'))) {
        throw new ValueError('Medication handover precedes preparation');
      }
    }
  }
  const occupied = new Set<string>();
  for (const resource of index.values()) {
    if (resource.resourceType === 'Appointment' && pyGet(resource, 'status') === 'booked') {
      for (const slot of references(pyGet(resource, 'slot'))) {
        if (occupied.has(slot)) {
          const target = index.get(slot);
          if (target === undefined) throw new KeyError(slot);
          if (!truthy(pyGet(target, 'overbooked'))) throw new ValueError('Double-booked slot without explicit overbooking');
        }
        occupied.add(slot);
      }
    }
  }
}

/** Duplicate, broken, cross-patient and workflow checks over a whole chart; returns the index. */
export function validate_graph(resources: Rec[], validate_shapes = true): Map<string, Rec> {
  const index = new Map<string, Rec>();
  for (const r of resources) index.set(ref(r), r);
  if (index.size !== resources.length) throw new ValueError('Duplicate resource identity');
  const owners = new Map<string, string | null>();
  for (const [key, resource] of index) owners.set(key, patientRef(resource));
  for (const [key, resource] of index) {
    if (validate_shapes) validate_resource(resource);
    for (const target of references(resource)) {
      if (['http:', 'https:', 'urn:', '#'].some((p) => target.startsWith(p))) continue;
      if (!index.has(target)) throw new ValueError(`Broken reference: ${key} -> ${target}`);
      const owner = owners.get(key), other = owners.get(target);
      if (owner && other && owner !== other) throw new ValueError(`Cross-patient reference: ${key} -> ${target}`);
    }
  }
  validate_workflow_graph(index);
  return index;
}
