// Build-time JSON compaction. Keep numeric source tokens exactly: 13.0, -0 and
// large integers must not change when the browser's Python-compatible parser reads them.
type JsonObject = Record<string, unknown>;
const losslessJSON = JSON as typeof JSON & { rawJSON(source: string): unknown };

function parseLossless(text: string): JsonObject {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    if (!context?.source || !losslessJSON.rawJSON) throw new Error('Data optimization requires Node 22 or newer');
    return losslessJSON.rawJSON(context.source);
  });
}

/** Compact whitespace without parsing or rewriting any string/number tokens. */
export function compactJson(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"|[\t\n\r ]+/g, (token) => token.startsWith('"') ? token : '');
}

/** Canonical serialized records for one shard; numeric tokens remain lossless. */
export function shardRecords(text: string): Map<string, string> {
  const shard = parseLossless(text) as { resources: JsonObject[] };
  return new Map(shard.resources.map((r) => [`${r.resourceType}/${r.id}`, JSON.stringify(r)]));
}

/** Only remove exact copies. Missing/different shard records remain embedded. */
export function compactChart(text: string, records: Map<string, string>): string {
  const chart = parseLossless(text) as { views: Record<string, JsonObject> };
  for (const [key, view] of Object.entries(chart.views)) {
    if (Object.hasOwn(view, 'resource') && records.get(key) === JSON.stringify(view.resource)) delete view.resource;
  }
  return JSON.stringify(chart);
}
