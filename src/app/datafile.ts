// Fetching the site's data files (public/data/). The production build gzips every .json there
// (vite.config.ts, gzipData: ~250 MB becomes ~35 MB), so in production each file is fetched as
// <file>.json.gz and decompressed in the browser. The dev server and tests read the plain files.

/** Production build: data files are stored gzipped. */
const GZIPPED = !!import.meta.env?.PROD;

/** A data file's text, or its HTTP status when the fetch failed. */
export interface DataText { ok: boolean; status: number; text: string }

/** The bytes as text, gunzipped when they are gzip (a host may already have decoded them). */
async function decode(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Fetch one data file (a .json path or URL) as text, from its .gz copy in production. */
export async function fetchDataText(url: string | URL): Promise<DataText> {
  const href = String(url);
  const gz = GZIPPED && /\.json(?:$|[?#])/.test(href);
  const r = await fetch(gz ? href.replace(/\.json(?=$|[?#])/, '.json.gz') : href);
  if (!r.ok) return { ok: false, status: r.status, text: '' };
  return { ok: true, status: r.status, text: gz ? await decode(await r.arrayBuffer()) : await r.text() };
}

/** Fetch and parse one data file as plain JSON; throws on an HTTP error. */
export async function fetchDataJson<T>(url: string | URL): Promise<T> {
  const r = await fetchDataText(url);
  if (!r.ok) throw new Error(`cannot load ${String(url)}: ${r.status}`);
  return JSON.parse(r.text) as T;
}
