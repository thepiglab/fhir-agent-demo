import { createReadStream, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Connect, Plugin } from 'vite';
import { compactChart, compactJson, shardRecords } from './scripts/optimize-data.ts';

// Local weights for testing (dev and preview servers only; never part of dist/): a GGUF placed in
// the git-ignored models/ folder is served at /models/<file>.gguf, with the byte ranges (206)
// that the WebGPU runtime reads. Use it as /?model=models/<file>.gguf.
const MODELS = fileURLToPath(new URL('./models/', import.meta.url));

function localModels(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const match = /^\/models\/([^/\\]+\.gguf)$/i.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!match || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    const name = decodeURIComponent(match[1]);
    let size: number;
    try {
      if (name.startsWith('.') || name.includes('/')) throw new Error('not a model file');
      const stats = statSync(MODELS + name);
      if (!stats.isFile()) throw new Error('not a file');
      size = stats.size;
    } catch {
      res.statusCode = 404;
      res.end('No such file in models/');
      return;
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    let start = 0, end = size - 1;
    const range = req.headers.range;
    if (range) {
      // bytes=a-b, bytes=a- or bytes=-n (the last n bytes); one range only.
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m && (m[1] || m[2])) {
        if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
        else { start = Math.max(size - Number(m[2]), 0); }
      }
      if (!m || !(m[1] || m[2]) || start > end || start >= size) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(MODELS + name, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };
  return {
    name: 'local-models',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

/**
 * Production only: remove exact chart/shard record duplicates, compact JSON losslessly,
 * and gzip (level 9) every .json under dist/data/ to reduce deployment and download sizes. Every loader goes
 * through src/app/datafile.ts, which asks for <file>.json.gz and decompresses it in the browser.
 * The dev server and the tests keep reading public/ as is.
 */
function gzipData(): Plugin {
  let outDir = 'dist';
  let publicDir = 'public';
  return {
    name: 'gzip-data',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; publicDir = config.publicDir; },
    closeBundle() {
      const root = join(outDir, 'data');
      if (!existsSync(root)) return;
      const shards = new Map<string, Map<string, string>>();
      for (const name of readdirSync(root, { recursive: true }) as string[]) {
        const file = join(root, name);
        if (!file.endsWith('.json') || !statSync(file).isFile()) continue;
        let text = readFileSync(file, 'utf8');
        const chart = /^charts[\\/]([^/\\]+)[\\/][^/\\]+\.json$/.exec(name);
        if (chart) {
          const sha = chart[1];
          const source = join(publicDir, 'data', 'shards', `${sha}.json`);
          if (existsSync(source)) {
            if (!shards.has(sha)) shards.set(sha, shardRecords(readFileSync(source, 'utf8')));
            text = compactChart(text, shards.get(sha)!);
          }
        }
        writeFileSync(`${file}.gz`, gzipSync(compactJson(text), { level: 9 }));
        unlinkSync(file);
      }
    },
  };
}

export default defineConfig({
  // Relative asset URLs, so dist/ works from any path (a Pages project, a subfolder, a Space).
  base: './',
  plugins: [react(), tailwindcss(), localModels(), gzipData()],
  // shadcn/ui and AI Elements import from "@/…" (src/).
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    // The vendored WebGPU runtime is one ~1 MB module.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Two pages, resolved from the project root.
      input: { main: 'index.html', chart: 'chart.html' },
      // Keep the WebGPU runtime in its own chunk, cached apart from app code.
      output: { manualChunks: (id: string) => (id.includes('/vendor/lfm3-webgpu-pi/') ? 'lfm3-runtime' : id.includes('/vendor/lfm3-lowbit/') ? 'lfm3-lowbit' : undefined) },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
