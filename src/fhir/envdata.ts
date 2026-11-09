// The two static JSON files the FHIR port reads (public/data/env/): the R4 JSON schema and the
// resource contracts. Python loads them from disk on first use; the browser cannot read files
// synchronously, so the page fetches them and passes them to setEnvData once before the store
// is used (tests read them from disk). Anything that needs them before that fails loudly.
import { Draft6Schema } from './jsonschema.ts';
import { isDict, type Rec } from './pyrt.ts';

let compiled: Draft6Schema | null = null;
let definitions: Rec | null = null;
let contracts: Rec | null = null;

/** Install fhir.schema.json and resource_contracts.json (both parsed with JSON.parse). */
export function setEnvData(data: { schema: unknown; contracts: unknown }): void {
  if (!isDict(data.schema) || !isDict(data.schema.definitions)) throw new Error('setEnvData: schema has no definitions');
  if (!isDict(data.contracts) || !isDict(data.contracts.contracts)) throw new Error('setEnvData: contracts has no "contracts"');
  definitions = data.schema.definitions;
  compiled = new Draft6Schema(definitions);
  contracts = data.contracts.contracts;
}

const unset = (): never => { throw new Error('FHIR environment data is not loaded: call setEnvData({schema, contracts}) first'); };

export const schemaDefinitions = (): Rec => definitions ?? unset();
export const schemaValidator = (): Draft6Schema => compiled ?? unset();
export const contractCatalog = (): Rec => contracts ?? unset();

/** Browser: fetch the two files from `base` (public/data/env/) and install them. */
export async function loadEnvData(base = 'data/env/'): Promise<void> {
  const [schema, contracts] = await Promise.all(
    ['fhir.schema.json', 'resource_contracts.json'].map(async (name) => {
      const response = await fetch(base + name);
      if (!response.ok) throw new Error(`cannot load ${base}${name}: ${response.status}`);
      return response.json() as Promise<unknown>;
    }),
  );
  setEnvData({ schema, contracts });
}
