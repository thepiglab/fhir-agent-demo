// Real store.request results from the demo's own store over every served chart shard, one
// pyDumps(result) per line (Python's json.dumps(result, ensure_ascii=False)), for the Lc goldens.
// node gen_results.ts <demo repo> <out.jsonl>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const [demo, out] = process.argv.slice(2) as [string, string];
const { pyParse, pyDumps } = await import(`${demo}/src/fhir/pyjson.ts`);
const { setEnvData } = await import(`${demo}/src/fhir/envdata.ts`);
const { episodeStore } = await import(`${demo}/src/fhir/store.ts`);
setEnvData({
  schema: JSON.parse(readFileSync(`${demo}/public/data/env/fhir.schema.json`, 'utf8')),
  contracts: JSON.parse(readFileSync(`${demo}/public/data/env/resource_contracts.json`, 'utf8')),
});

type Rec = Record<string, any>;
const lines: string[] = [];
const seen = new Set<string>();
const add = (tag: string, method: string, path: string, result: unknown) => {
  const text = pyDumps(result);
  if (seen.has(text)) return;
  seen.add(text);
  lines.push(JSON.stringify({ tag, method, path, result: text }));
};

const shards = readdirSync(`${demo}/public/data/shards`).sort();
for (const file of shards) {
  const shard = pyParse(readFileSync(`${demo}/public/data/shards/${file}`, 'utf8')) as Rec;
  const resources = shard.resources as Rec[];
  const patients = resources.filter((r) => r.resourceType === 'Patient');
  const pid = patients[0]?.id as string;
  const store = episodeStore({ patient_id: pid, omit: [], writable_types: [...new Set(resources.map((r) => r.resourceType as string))], delete_refs: [] }, resources, 10_000, 'v0.6');
  const run = (tag: string, method: string, path: string, body: unknown = null, headers: Rec = {}) => {
    try { add(tag, method, path, store.request(method, path, body, headers)); } catch (e) { /* the store raised: not a result */ }
  };
  const types = [...new Set(resources.map((r) => r.resourceType as string))].sort();
  for (const kind of types) {
    const params = store.search_params(kind) as Set<string>;
    const who = params.has('patient') ? 'patient' : params.has('subject') ? 'subject' : null;
    const q = who ? `${who}=Patient/${pid}` : '';
    run(`search:${kind}`, 'GET', `${kind}?${q}&_count=50`);
    run(`page:${kind}`, 'GET', `${kind}?${q}&_count=2`);
    run(`page2:${kind}`, 'GET', `${kind}?${q}&_count=2&_page=1`);
    run(`empty:${kind}`, 'GET', `${kind}?_id=no-such-id`);
    for (const inc of (store.constructor as any).INCLUDES ? [] : []) void inc;
    const one = resources.find((r) => r.resourceType === kind)!;
    run(`read:${kind}`, 'GET', `${kind}/${one.id}`);
  }
  for (const inc of ['DiagnosticReport:result', 'MedicationRequest:medication', 'Observation:has-member', 'Observation:based-on', 'Task:focus', 'Coverage:payor', 'ServiceRequest:subject', 'Specimen:request', 'List:item', 'Appointment:slot', 'MedicationAdministration:request', 'DeviceUseStatement:device']) {
    const kind = inc.split(':')[0]!;
    if (!types.includes(kind)) continue;
    const params = store.search_params(kind) as Set<string>;
    const who = params.has('patient') ? `patient=Patient/${pid}&` : params.has('subject') ? `subject=Patient/${pid}&` : '';
    run(`include:${inc}`, 'GET', `${kind}?${who}_include=${inc}`);
  }
  run('patient-search', 'GET', `Patient?_id=${pid}`);
  run('error:unknown-type', 'GET', 'Foo?x=1');
  run('error:bad-param', 'GET', 'Observation?nonsense=1');
  run('error:missing', 'GET', 'Observation/does-not-exist');
  const obs = resources.find((r) => r.resourceType === 'Observation');
  if (obs) {
    const copy = JSON.parse(JSON.stringify(obs)); delete copy.id; delete copy.meta;
    run('write:post', 'POST', 'Observation', pyParse(JSON.stringify(copy)));
    run('write:put-no-ifmatch', 'PUT', `Observation/${obs.id}`, obs);
  }
}
writeFileSync(out, lines.join('\n') + '\n');
console.log(`${lines.length} results from ${shards.length} shards`);
