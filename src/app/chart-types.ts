// Shapes of the chart panel's routes (/api/summary, /api/chart, /api/resource, /api/fhir), as
// scripts/web_demo/export_chart_site.py writes them from demo/app.py and src/chart/api.ts returns them.

/** One dated value of a lab or vital series. */
export interface Point {
  ref: string;
  date: string | null;
  value: number | string | null;
  unit: string | null;
  text: string | null;
  flag: 'H' | 'L' | 'HH' | 'LL' | 'A' | null;
  flag_source: 'typical range' | 'record range' | string | null;
  range: string | null;
  status: string | null;
}
export interface Series {
  code: string;
  name: string;
  kind?: string;
  count: number;
  change: number | null;
  trend: 'up' | 'down' | 'same' | null;
  latest: Point;
  previous: Point | null;
  points: Point[];
}
/** A summary item: a record with its display text. */
export interface Item {
  ref: string;
  type: string;
  text: string;
  label?: string | null;
  date: string | null;
  status?: string | null;
}
export interface Allergy extends Item { reactions: string[]; criticality: string | null; verification?: string | null }
export interface Problem extends Item { clinical_status: string | null }
export interface Medication extends Item { dose: string | null; source: string }
export interface Encounter {
  ref: string;
  class: string | null;
  class_code: string | null;
  start: string | null;
  end: string | null;
  type_text: string | null;
  reason: string | null;
  where: string | null;
  status: string | null;
  label: string | null;
  linked?: Record<string, number>;
}
export interface DocItem {
  ref: string;
  type: string;
  kind: 'report' | 'note' | 'composition';
  date: string | null;
  label: string | null;
  status: string | null;
  authors: string[];
  snippet: string | null;
  encounter: { ref: string; exists: boolean; date: string | null } | null;
}
export interface Appointment { ref: string; start: string | null; what: string | null; with: string[]; status: string | null }
export interface Order { ref: string; ordered: string | null; text: string; status: string | null; reports: { status: string }[] }

export interface Summary {
  patient: string;
  as_of: string | null;
  allergies: { items: Allergy[]; none_known: Allergy[] };
  code_status: { ref: string; text: string; date: string | null } | null;
  alerts: Item[];
  problems: Problem[];
  medications: Medication[];
  labs: Series[];
  vitals: Series[];
  encounters: { recent: Encounter[]; total: number };
  documents: { recent: DocItem[]; total: number };
  appointments: { upcoming: Appointment[]; past: Appointment[]; total: number };
  orders: Order[];
  changes: number;
}

export interface ChartRecord { ref: string; type: string; date: string | null; label: string | null; status: string | null }
export interface ChartGroup { scope: 'own' | 'referenced' | 'referencing' | string; type: string; count: number; records: ChartRecord[] }
export interface FullChart {
  patient: string;
  as_of: string | null;
  total: number;
  groups: ChartGroup[];
  encounters: Encounter[];
  documents: DocItem[];
  changes: number;
}

/** A link between records (a reference in one record to another). */
export interface Link {
  ref: string;
  type: string | null;
  path: string | null;
  relation: string | null;
  label: string | null;
  date: string | null;
  status: string | null;
  exists: boolean;
}
export interface Fact { field: string; label?: string | null; text?: string; refs?: Link[] }
export interface ResultRow {
  ref: string; exists: boolean; depth: number; name: string | null; value: string | null;
  flag: string | null; range: string | null; date: string | null; status: string | null; members: number;
}
export interface Attachment {
  title: string | null; content_type: string | null; bytes: number | null; language: string | null;
  creation: string | null; text: string | null; truncated: boolean; note: string | null; url: string | null;
}
export interface Section { title: string | null; depth: number; text: string | null; entries: Link[] }
export interface RecordView {
  ref: string;
  type: string;
  label: string | null;
  date: string | null;
  status: string | null;
  owner: string | null;
  scope: 'own' | 'shared' | 'other';
  resource: unknown;
  readable: {
    facts: Fact[];
    narrative?: string | null;
    conclusion?: string | null;
    results?: ResultRow[];
    attachments?: Attachment[];
    sections?: Section[];
  };
  incoming: Link[];
  outgoing: Link[];
  changes: number;
}

/** /api/fhir: the store's response to a console request. */
export interface ConsoleResult {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
  ms: number;
  changes: number;
}
export interface ConsoleRequest {
  method?: string;
  path: string;
  body?: unknown;
  if_match?: string;
  if_none_exist?: string;
}
