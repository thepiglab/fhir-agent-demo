// Port of fhir_query_rl/resource_contracts.py at bf9db15 (sha256 7f9a9cdc4f9cc58df599614026e7e4e56ba0c6e080f0f098bb62cc2ee21668c2)
//
// Offline contracts extracted from official R4 StructureDefinition snapshots. The catalog is
// public/data/env/resource_contracts.json, installed by setEnvData.
import { contractCatalog } from './envdata.ts';
import { ref, references } from './validation.ts';
import { KeyError, TypeError_, ValueError, hasOwn, isDict, iterate, pyTypeName, subscript, type Rec } from './pyrt.ts';

interface Contract { path: string[]; min: number; max: string; types?: string[]; targets?: string[] }

/** The catalog: resource type -> element contracts. */
export const catalog = (): Rec => contractCatalog();

export function parents(resource: unknown, path: string[]): Rec[] {
  let values: unknown[] = [resource];
  for (const part of path) {
    const next: unknown[] = [];
    for (const value of values) {
      if (!isDict(value)) continue;
      const children = part.endsWith('[x]')
        ? Object.entries(value).filter(([k]) => k.startsWith(part.slice(0, -3)) && !k.startsWith('_')).map(([, v]) => v)
        : [hasOwn(value, part) ? value[part] : null];
      for (const child of children) {
        if (Array.isArray(child)) next.push(...child);
        else if (child !== null && child !== undefined) next.push(child);
      }
    }
    values = next;
  }
  return values.filter(isDict);
}

export function validate_contracts(resources: Rec[]): void {
  for (const resource of resources) {
    const kind = subscript(resource, 'resourceType');
    if (Array.isArray(kind) || isDict(kind)) throw new TypeError_(`unhashable type: '${pyTypeName(kind)}'`);
    if (typeof kind !== 'string' || !hasOwn(catalog(), kind)) throw new KeyError(kind);
    for (const c of iterate(catalog()[kind]) as Contract[]) {
      const field = c.path[c.path.length - 1];
      for (const parent of parents(resource, c.path.slice(0, -1))) {
        let names = [field];
        if (field.endsWith('[x]')) names = (c.types ?? []).map((t) => field.slice(0, -3) + t[0].toUpperCase() + t.slice(1));
        const present = names.filter((k) => hasOwn(parent, k) || hasOwn(parent, '_' + k));
        if (c.max === '1' && present.some((k) => Array.isArray(parent[k]))) {
          throw new ValueError(`${ref(resource)}: cardinality ${c.path.join('.')} requires a scalar, not an array`);
        }
        if (present.length > 1) throw new ValueError(`${ref(resource)}: multiple choices for ${c.path.join('.')}`);
        let values: unknown[] = present.flatMap((k) => (Array.isArray(parent[k]) ? parent[k] as unknown[] : [hasOwn(parent, k) ? parent[k] : null]));
        if (!values.length && present.length) values = [null];  // primitive extension-only value
        const count = values.length;
        if (count < c.min || (c.max !== '*' && count > parseInt(c.max, 10))) {
          throw new ValueError(`${ref(resource)}: cardinality ${c.path.join('.')}=${count}, expected ${c.min}..${c.max}`);
        }
        if (c.targets?.length && !c.targets.includes('Resource')) {
          for (const target of references(values)) {
            if (['http:', 'https:', 'urn:', '#'].some((p) => target.startsWith(p))) continue;
            if (!c.targets.includes(target.split('/')[0])) {
              throw new ValueError(`${ref(resource)}: invalid reference target ${field} -> ${target}`);
            }
          }
        }
      }
    }
  }
}
