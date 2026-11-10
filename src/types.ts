// Shared shapes: FHIR records, the Chart assistant's patients and benchmark tasks.

/** A FHIR resource as the store holds it. Fields beyond these are unchecked JSON. */
export interface FhirResource {
  resourceType: string;
  id: string;
  meta?: { versionId?: string; tag?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

/** demo/app.py's ChartIndex patient entry. */
export interface ChartPatient {
  id: string;
  ref: string;
  mrn: string | null;
  name: string;
  gender?: string | null;
  birth_date?: string | null;
  age?: number | null;
  as_of: string | null;
  shard: string;
  /** Problem-list labels (up to 4) and medication labels (up to 2), for telling patients apart. */
  problems?: string[];
  medications?: string[];
  /** Resources in the chart by type (Encounter, DocumentReference, …). */
  counts?: Record<string, number>;
  [key: string]: unknown;
}

/** One benchmark task, as scripts/web_demo/export_chart_site.py writes it. */
export interface BenchTask {
  id: string | null;
  family: string;
  label?: string;
  track?: string | null;
  persona?: string | null;
  style?: string | null;
  premise?: boolean | null;
  role?: string | null;
  crud?: string | null;
  read_only?: boolean;
  prompt: string;
  question: string;
  gold: string[] | null;
  gold_answer: unknown;
  optional?: string[];
  skipped?: string | null;
  [key: string]: unknown;
}
