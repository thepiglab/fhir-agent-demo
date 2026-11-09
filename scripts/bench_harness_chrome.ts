// Harness timing and memory in a dedicated Google Chrome (macOS): loads the Chart assistant with a
// given context size, replays recorded runs' contexts through the WebGPU runtime
// (scripts/bench_harness_page.ts) and samples the memory footprint of Chrome's processes every
// 0.5 s (as scripts/bench_chrome.ts does).
//
//   npm run dev &     (GGUF in models/, contexts from scripts/bench_harness_contexts.ts in models/)
//   node scripts/bench_harness_chrome.ts \
//     "http://localhost:5173/chart.html?model=models/<file>.gguf&harness=X16&ctx=32768" \
//     /models/harness-bench-x16.json out.json
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, contexts, out] = [process.argv[2]!, process.argv[3] || '/models/harness-bench.json', process.argv[4] || 'bench-harness.json'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), 'fhir-harness-bench-'));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1400,1000', 'about:blank',
], { stdio: 'ignore' });

// --- memory: footprint of this Chrome's processes, by type --------------------------------
interface Sample { t: number; phase: string; [type: string]: number | string }
const samples: Sample[] = [];
function chromePids(): { pid: string; type: string }[] {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command=']).toString().split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ pid: m[1]!, ppid: m[2]!, type: m[3]!.match(/--type=([\w-]+)/)?.[1] ?? 'browser' }));
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
    return m ? Number(m[1]) * UNITS[m[2]!]! : null;
  } catch { return null; }
}
/** GPU memory in use system-wide (MB), from the Apple GPU driver: on Apple silicon WebGPU buffers
 * live in unified memory that `footprint` does not attribute to Chrome's processes. */
function gpuInUseMB(): number | null {
  try {
    const m = execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'AGXAccelerator']).toString().match(/"In use system memory"=(\d+)/);
    return m ? Number(m[1]) / 2 ** 20 : null;
  } catch { return null; }
}
const gpuBaselineMB = gpuInUseMB();
let sampling = true, phase = 'start';
void (async () => {
  while (sampling) {
    const byType: Record<string, number> = {};
    for (const { pid, type } of chromePids()) {
      const mb = footprintMB(pid);
      if (mb !== null) byType[type] = (byType[type] ?? 0) + mb;
    }
    const gpu = gpuInUseMB();
    if (gpu !== null) byType.gpuDriver = gpu;
    samples.push({ t: Date.now(), phase, ...byType });
    await sleep(500);
  }
})();

// --- minimal CDP client -----------------------------------------------------------------
interface CdpMessage { id?: number; result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }
async function connect(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[];
      const page = tabs.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
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
  if (msg.id !== undefined) { pending.get(msg.id)?.(msg); pending.delete(msg.id); }
});
const send = (method: string, params: Record<string, unknown> = {}) => new Promise<CdpMessage>((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression: string): Promise<unknown> {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
phase = 'load';
await send('Page.navigate', { url });
const t0 = Date.now();
let state = '';
for (let i = 0; i < 900; i++) {
  await sleep(500);
  // Read the top bar, not a module: a dev server that hot-updated files serves them with ?t=, and
  // a fresh import() would get a second, idle instance. (Restart the dev server before measuring,
  // or bench_harness_page.ts's import of the model host could load a second model.)
  const bar = String(await evaluate("document.querySelector('header')?.innerText ?? ''").catch(() => ''));
  state = /\bReady\b/.test(bar) ? 'ready' : /No WebGPU/.test(bar) ? 'unsupported' : /Model error/.test(bar) ? 'error' : 'loading';
  if (state === 'ready' || state === 'error' || state === 'unsupported') break;
}
if (state !== 'ready') throw new Error(`model state ${state}`);
const loadSeconds = (Date.now() - t0) / 1000;
phase = 'idle';
await sleep(3000);
phase = 'bench';
const summary = await evaluate(`import('/scripts/bench_harness_page.ts').then(async (b) => { await b.run(${JSON.stringify(contexts)}); return JSON.stringify(b.summary()); })`);
phase = 'done';
await sleep(1500);
sampling = false;
await sleep(600);

const mb = (s: Sample | undefined, k: string) => Number(s?.[k] ?? 0);
const total = (s: Sample) => ['gpu-process', 'renderer', 'browser', 'utility'].reduce((a, k) => a + mb(s, k), 0);
const peak = (f: (s: Sample) => number, phases?: string[]) => Math.max(...samples.filter((s) => !phases || phases.includes(s.phase)).map(f));
const result = {
  url, contexts, loadSeconds,
  chrome: execFileSync(CHROME, ['--version']).toString().trim(),
  memoryMB: {
    gpuProcessPeak: peak((s) => mb(s, 'gpu-process')),
    gpuProcessIdle: peak((s) => mb(s, 'gpu-process'), ['idle']),
    rendererPeak: peak((s) => mb(s, 'renderer')),
    totalPeak: peak(total),
    totalIdle: peak(total, ['idle']),
    // System-wide GPU memory above the level before Chrome started (other apps' use included).
    gpuDriverBaseline: gpuBaselineMB,
    gpuDriverPeakAboveBaseline: gpuBaselineMB === null ? null : peak((s) => mb(s, 'gpuDriver')) - gpuBaselineMB,
    gpuDriverIdleAboveBaseline: gpuBaselineMB === null ? null : peak((s) => mb(s, 'gpuDriver'), ['idle']) - gpuBaselineMB,
  },
  bench: JSON.parse(String(summary)),
  samples,
};
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ loadSeconds, memoryMB: result.memoryMB, X16: result.bench.X16, L: result.bench.L, errors: result.bench.rows.flatMap((r: { errors: string[] }) => r.errors) }, null, 1));
ws.close();
chrome.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
process.exit(0);
