// Benchmark the browser demo in Google Chrome on macOS: load time, per-question speed and
// accuracy against the pilot gold, and the memory footprint of Chrome's GPU and renderer
// processes (sampled with `footprint` every 0.5 s).
//
//   npm run dev &        (with the GGUF in models/)
//   npm run bench -- "http://localhost:5173/?simple=1&model=models/<file>.gguf&autoload=1" [out.json] [--cold]
//
// The page URL must include simple=1 (the model page's own ask card) and autoload=1.
//
// Chrome runs with a throwaway profile, so the first load is cold unless the profile dir is
// reused. Without --cold the page is loaded twice and the second (warm, weights cached in
// IndexedDB by the runtime) load is benchmarked.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const cold = process.argv.includes('--cold');
const url = args[0] || 'http://localhost:5173/?simple=1&autoload=1';
const out = args[1] || 'bench-chrome.json';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'fhir-webgpu-bench-'));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One memory sample: footprint in MB per Chrome process type, at a benchmark phase. */
interface Sample { t: number; phase: string; [processType: string]: number | string }
/** One question's result, from the page's window.runBench(). */
interface BenchResult {
  family: string; ok: boolean; answerMatch: boolean; evidenceMatch: boolean; ms: number; turns: number; calls: number;
  completionTokens: number; decodeMs: number; newPromptTokens: number; ttftMs: number; contextTokens: number; error: string | null;
}
interface Bench { load: unknown; results: BenchResult[] }
interface CdpMessage { id?: number; result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }

const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--window-size=1400,1000', 'about:blank',
], { stdio: 'ignore' });

// --- memory sampling: footprint of this Chrome's GPU process and renderers ---------------
const samples: Sample[] = [];
function chromePids(): { pid: string; ppid: string; type: string }[] {
  // The launched browser process and all its descendants (GPU, renderers, utilities).
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command=']).toString().split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ pid: m[1], ppid: m[2], type: m[3].match(/--type=([\w-]+)/)?.[1] ?? 'browser' }));
  const keep = new Set([String(chrome.pid)]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (!keep.has(r.pid) && keep.has(r.ppid)) { keep.add(r.pid); grew = true; }
  }
  return rows.filter((r) => keep.has(r.pid));
}
const UNITS: Record<string, number> = { KB: 1 / 1024, MB: 1, GB: 1024 };
function footprintMB(pid: string): number | null {
  try {
    const line = execFileSync('footprint', [pid], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n')[1] ?? '';
    const m = line.match(/Footprint: ([\d.]+) (KB|MB|GB)/);
    return m ? Number(m[1]) * UNITS[m[2]] : null;
  } catch { return null; }
}
let sampling = true, phase = 'start';
(async () => {
  while (sampling) {
    const t = Date.now();
    const byType: Record<string, number> = {};
    for (const { pid, type } of chromePids()) {
      const mb = footprintMB(pid);
      if (mb !== null) byType[type] = (byType[type] || 0) + mb;
    }
    samples.push({ t, phase, ...byType });
    await sleep(500);
  }
})();

// --- minimal CDP client --------------------------------------------------------------
async function connect(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[];
      const page = tabs.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome did not expose a page target');
}
const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map<number, (msg: CdpMessage) => void>();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(String(e.data)) as CdpMessage;
  const resolve = msg.id === undefined ? undefined : pending.get(msg.id);
  if (resolve && msg.id !== undefined) { resolve(msg); pending.delete(msg.id); }
});
const send = (method: string, params: Record<string, unknown> = {}) => new Promise<CdpMessage>((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression: string): Promise<unknown> {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
}
async function loadPage(): Promise<string> {
  await send('Page.navigate', { url });
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    const s = await evaluate("JSON.stringify({ready: !!window.demoState?.ready, state: document.getElementById('model-state')?.textContent || ''})").catch(() => null);
    if (typeof s !== 'string') continue;
    const { ready, state } = JSON.parse(s) as { ready: boolean; state: string };
    if (ready) return state;
    if (/^Could not load|^Error/.test(state)) throw new Error(state);
  }
  throw new Error('model did not load in 5 minutes');
}

await send('Page.enable');
await send('Runtime.enable');
const result: Record<string, unknown> = { url, chrome: execFileSync(CHROME, ['--version']).toString().trim(), cold };
if (!cold) { phase = 'warmup-load'; result.firstLoad = await loadPage(); }
phase = 'load';
result.loadStatus = await loadPage();
phase = 'idle';
await sleep(3000);
phase = 'bench';
const bench = await evaluate('window.runBench()') as Bench;
phase = 'done';
await sleep(1500);
sampling = false;
await sleep(600);

// --- summary -------------------------------------------------------------------------
const base = samples.find((s) => s.phase === 'load') || samples[0];
const mb = (s: Sample | undefined, k: string): number => Number(s?.[k] ?? 0);
const peak = (k: string, ph?: string[]) => Math.max(...samples.filter((s) => !ph || ph.includes(s.phase)).map((s) => mb(s, k)));
const rs = bench.results;
type Numeric = 'completionTokens' | 'decodeMs' | 'newPromptTokens' | 'ttftMs';
const tot = (k: Numeric) => rs.reduce((a, r) => a + r[k], 0);
result.load = bench.load;
result.results = rs;
result.summary = {
  questions: rs.length,
  validJson: rs.filter((r) => r.ok).length,
  answerMatch: rs.filter((r) => r.answerMatch).length,
  answerAndEvidenceMatch: rs.filter((r) => r.answerMatch && r.evidenceMatch).length,
  decodeTokPerS: tot('completionTokens') / tot('decodeMs') * 1000,
  prefillTokPerS: tot('newPromptTokens') / tot('ttftMs') * 1000,
  medianEpisodeS: rs.map((r) => r.ms / 1000).sort((a, b) => a - b)[rs.length >> 1],
  maxContextTokens: Math.max(...rs.map((r) => r.contextTokens)),
  memoryMB: {
    gpuProcessBaseline: mb(base, 'gpu-process'), gpuProcessPeak: peak('gpu-process'),
    rendererBaseline: mb(base, 'renderer'), rendererPeakLoad: peak('renderer', ['load']), rendererPeakBench: peak('renderer', ['bench']),
    totalPeak: Math.max(...samples.map((s) => mb(s, 'gpu-process') + mb(s, 'renderer') + mb(s, 'browser') + mb(s, 'utility'))),
  },
};
result.samples = samples;
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result.summary, null, 1));
ws.close();
chrome.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
process.exit(0);
