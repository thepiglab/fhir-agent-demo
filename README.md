# LFM3 FHIR demo: an EHR search agent on your device

A 1.7B-parameter model (Liquid AI's LFM3, fine-tuned by us) answers questions about a health
record by calling FHIR searches, then cites the records it used. Everything runs in the
browser on WebGPU: the model, the synthetic charts and every search. There is no backend.

## Run it

With [bun](https://bun.sh) or npm (Node 20+):

```bash
bun install && bun run dev      # or: npm install && npm run dev
```

Open the printed URL (http://localhost:5173) in Chrome or Edge.

```bash
bun run build                   # static site in dist/ (or: npm run build)
bun run preview                 # serve dist/ at http://localhost:4173 (or: npm run preview)
bun run typecheck               # strict TypeScript check (or: npm run typecheck)
```

`dist/` is plain static files. Host it anywhere; see [Deploy](#deploy).

## Using it

1. **Landing page** (`index.html`): one button. If the weights are not in this browser yet it reads
   **Download the model and start · 1.1 GB**: it fetches them from Hugging Face
   ([`mkieffer/LFM3-FHIR-demo-v1`](https://huggingface.co/mkieffer/LFM3-FHIR-demo-v1), pinned to one
   commit) with a progress bar, then opens the Chart assistant by itself. Next time the button opens it
   at once (the weights load from browser storage in seconds). **Model details** has the facts, a local
   GGUF option and **Remove from this browser**.
2. **Chart assistant** (`chart.html`):
   - **Top bar:** the **Dataset** menu: natural prompts v0.2.3, dev patients (the default, whichever
     release the export was given) and held-out patients, natural questions only. In the developer
     view it also lists the previous release, natural prompts v0.2.2. The choice is kept in
     `?cohort=` and local storage.
   - **Benchmark questions:** each shows its structural difficulty, specialty and purpose, and the
     browser filters by them. Shuffle and the default pick lean to medium and hard questions unless
     a difficulty filter is on. The developer view adds the negative kind (the four kinds new in
     v0.2.3, drug never taken, wrong date, not in your records and decline advice, marked "new"),
     stretch, single-hop and the teachers' difficulty bin, and a filter by negative kind. The model status
     (click for the model card: download, local file, remove) and a "⋯" menu (theme, developer view,
     About).
   - **Patient:** the name at the top of the conversation opens the patient switcher (also ⌘K /
     Ctrl+K). The panel button opens the chart (a column on desktop, a drawer on tablets, a sheet
     on phones): Summary, Records, Record and, in the developer view, the FHIR console. When
     questions or the console changed this patient's private sandbox copy, a bar offers **Reset**.
   - **Ask:** type or pick a suggestion. The suggestions take several steps each (an ED visit and
     its follow-up, a referral and whether it closed, a lab corrected after release) and one per
     voice is a negative, where "not in the chart" is the answer; each is offered only where this
     chart can answer it. The hemoglobin trend is offered only on charts with six or more results
     in the past year, and the page opens on such a patient. While the model works, a dot loader names the current step;
     afterwards "Worked for 14s · 3 searches ›" opens the reasoning and each FHIR request. The answer
     is drawn from the cited records (after a free-response answer, a second, tool-free LFM3 turn
     writes 1–4 sentences above it, citing the agent's records as numbered links; it is shown only
     if every citation is one the agent made and every number is in those records, else the card
     stands alone; benchmark questions get no reply, see `src/chart/reply.ts`): one value as a headline, a trend as a chart with a table (fewer than three values: a short
     table only), lists
     as a table; values underlined when backed by a record that was read (hover to see it, click to
     open it). Writes show what changed, field by field, and fold the rejected attempts away.
   - **Benchmark:** the composer holds one benchmark question with its exact prompt. Shuffle picks
     from the whole dataset and switches patient, Next steps through this patient's questions, and
     the list icon opens the question browser (search, this patient or all patients, filters;
     difficulty and specialty too, as chips and filters, once a release has those tags). A
     question always shows unless you clear it. The run happens in a fresh copy of the chart, as the
     evaluator builds it, and is graded with the project's scorer, ported to TypeScript and tested
     against the Python one (v0.6 rules, 40 tool calls, strict reward): Pass or Fail, then Answer,
     Evidence and Chart changes with their details.

**Model source:** `src/model/config.ts` → `MODEL`, written as `owner/repo@commit/file.gguf` on
Hugging Face. The commit pins the exact file (SFT v0.6.1, sha256 in `MODEL_FILE`) and also keys the
browser's cache, so moving the pin makes every browser download the new file; after a load, cached
copies of the same file under other URLs are deleted. `?model=` in the page URL overrides it.

**Harness:** `src/model/config.ts` → `MODEL_HARNESS`, the harness the model was trained in.
`L` is the locked harness (one `fhir_request` tool, results as JSON), for SFT v0.6.1. `X16` is the
harness-suite profile X16 (Context-1 at a 16,384-token budget: `[r3]` handles, a `prune` tool, the
`[Token usage: N/16,384 | turn t/20]` line, overflow pruning, "already shown above" stubs, the turn
ramp), for LFM3 SFT v0.6.1-X16; `src/fhir/context1.ts` ports it byte for byte. `X16v2` is X16 with
exact token counts (LFM3's tokenizer, ported in `src/fhir/tokenizer.ts`, data in
`public/data/tokenizer/`, loaded only for X16v2), a hard cap on real prompt tokens and pruning to
60%, for the LFM3 RL checkpoint (`src/fhir/context1_v2.ts`). Switch it together with `MODEL`. `?harness=L`, `?harness=X16` or `?harness=X16v2` in the page URL overrides it; L stays as the fallback.
The runtime's context is 16,384 tokens (`contextTokens()` in the same file). X16's budget is an
estimate, so a question can outgrow it; the run then ends with a "too long" message. The ⋯ menu's
**Long charts** setting gives 24,576 (about 0.24 GB more GPU memory); `?ctx=<tokens>` overrides it.

**Testing a local GGUF:** put the file in `models/` at the project root (git-ignored) and open
`/?model=models/<file>.gguf`. Only the dev and preview servers serve that folder (byte ranges
and `HEAD` included, see `vite.config.ts`); it is never copied into `dist/`, so a deployed site
cannot offer it. The landing page's **Use a local GGUF…** (Model details) loads a file from disk without a
server, and works on any host.

## Browser requirements

- **Browser:** Chrome or Edge 121+ on a desktop or laptop, with WebGPU (check `chrome://gpu`).
  Safari and Firefox are untested.
- **Memory:** about 3.2 GB at peak.
- **Storage:** about 1.2 GB of free browser storage for the cached weights.
- **Speed:** on an Apple M1 Max in Chrome 156, about 127 tokens/s and 8 s per question.

## Project layout

```
index.html               landing page (entry 1)
chart.html               Chart assistant (entry 2)
vite.config.ts           multi-page build, relative base, dev-only /models/ server
models/                  local GGUFs for testing (git-ignored; dev and preview servers only)
tsconfig.json            strict TypeScript (scripts/ and tests/ have their own)
.github/workflows/       deploy-pages.yml: build and publish dist/ to GitHub Pages
src/
  model/                 config.ts (weights source), model.ts (download, cache, offload,
                         local file), raf-shim.ts (keeps loading in background tabs)
  fhir/                  the environment, ported from Python and tested against it: store.ts
                         (FhirStore, episodeStore), validation.ts, jsonschema.ts, contracts.ts,
                         protocol.ts, scoring.ts (evaluateTraining), pyrt.ts and pyjson.ts
                         (Python semantics), envdata.ts (schema and contracts loader), tools.ts (fhir_request
                         argument decoding and FastMCP validation), context1.ts and exposure.ts
                         (harness X16);
                         fhir_store.ts keeps the app's old import names
  agent/chat.ts          final-answer parsing
  chart/                 data.ts (lazy data loading, cohorts, the chosen question),
                         api.ts (the Chart assistant's backend, in the browser: routes, sandbox,
                         episodes, the tool layer, grading, token streaming), model-host.ts (one
                         shared model load with status), trace.ts (plain-language steps, sources,
                         citation checks, changeView)
  chat/                  the Chart assistant (React 19 + Tailwind v4 + shadcn/ui): main.tsx (entry),
                         App.tsx (layout), store.ts (React view of app/state.ts), theme.ts,
                         shell/ (top bar, patient switcher, chart panel host), benchmark/
                         (question logic, the question in the composer, the question browser),
                         model/ (status, model card), conversation/ (thread, composer, runs,
                         answers as generative UI: stat, trend chart, table; grade card)
  components/            ui/ (shadcn/ui) and ai-elements/ (AI Elements), see components/NOTICE.md
  lib/utils.ts           cn()
  app/                   framework-free parts: state.ts (shared store and events), chart-*.ts
                         (the chart panel), model-gate.ts (model status), dom.ts, tokens.css
  ui/                    model-page.ts (landing page; ?simple=1 self-test for bench_chrome)
  types.ts               shared types: FHIR records, patients, benchmark tasks
  styles/                landing page styles (on top of app/tokens.css)
public/
  data/
    contract.json        system prompt and fhir_request tool schema the model was trained with
    patient.json         one patient for the landing page's self-test (?simple=1)
    config.json          what the page's /api/config returns (examples, contracts, limits)
    cohorts.json         the benchmark cohorts, with counts
    shards/<sha>.json    one chart shard (the FHIR records, record cards, code names); shared
                         by cohorts and named by the hash of its source
    charts/<sha>/<patient>.json   a patient's summary, chart and record views
    <cohort>/patients.json        the cohort's patients (with shard_sha)
    <cohort>/questions.json       index of the cohort's tasks, for the picker and Random
    <cohort>/tasks/<patient>.json the patient's raw task rows (prompt, gold, write scope)
    env/                 FHIR R4 JSON schema and resource contracts, loaded before the first write
vendor/lfm3-webgpu-pi/   WebGPU inference runtime (JS, Apache-2.0; LICENSE and NOTICE inside),
                         with Lfm3ForCausalLM.d.ts typing the parts this app calls
scripts/bench_chrome.ts  speed and accuracy benchmark in Chrome (npm run bench)
tests/                   vitest: parity tests for the port (tests/parity, about 10 minutes), the
                         changeView test (trace-changes) and the API test (chart-api)
```

**Which files to edit:**
- **UI:** `src/chat/`, `src/components/`, `src/app/` (except `state.ts`'s contracts), `src/ui/`,
  `src/styles/`, `src/chart/` (except what is listed below), `index.html` and `chart.html` are
  yours. Colours come from the shadcn theme in `src/styles/app.css` (`tokens.css` maps onto it),
  so light and dark keep working.
- **Leave alone:**
  - `src/fhir/` (except `fhir_store.ts`) and `tests/parity/` are the port of the environment
    and its gate. They must stay equal to the Python the model was trained on.
  - `src/chart/trace.ts` is checked against Python by tests in fhir-env; add functions, do not
    change existing ones.
  - `public/data/` is generated by the fhir-env repo (`scripts/web_demo/export_chart_site.py`).

## Tests

```bash
npm run typecheck                       # strict TypeScript, source, scripts and tests
npx vitest run tests/chart-api.test.ts  # the /api routes over the real data, no model needed
npx vitest run tests/trace-changes.test.ts   # changeView against Python's change_view
npm test                                # everything, including the parity tests (about 10 minutes)
```

## Chart data

`public/data/` (about 95 MB: charts, shards, task indexes for the four cohorts) is generated from the
benchmark data roots by the fhir-env repo's `scripts/web_demo/export_chart_site.py`, and committed:
a static host builds from git and cannot run the exporter. Rerun the exporter and commit again when
the benchmark data changes. If the data is missing, the Chart assistant says so instead of loading.

## Deploy

The site is static: `npm run build` writes `dist/` (about 108 MB in 430 files: the page code is
under 1.2 MB, the rest is the exported data). There is no server code and nothing to configure.
The build copies whatever `public/data/` holds, so that folder must be in the checkout (committed,
or generated by the fhir-env repo's `export_chart_site.py` and copied in) before `npm run build`.

- **No special headers.** The WebGPU runtime uses no `SharedArrayBuffer`, `Atomics` or `Worker`
  (checked in `vendor/lfm3-webgpu-pi/Lfm3ForCausalLM.js`), so the site needs no cross-origin
  isolation: no COOP/COEP headers and no `coi-serviceworker`. Adding them would only block loading
  the model from Hugging Face.
- **HTTPS.** WebGPU needs a secure context. GitHub Pages serves HTTPS;
  `localhost` is exempt for local testing.
- **File sizes.** The largest data file is `data/env/fhir.schema.json` at 3.4 MB, then chart
  shards at up to 2.3 MB. That is far under GitHub Pages' limits (100 MB per file, 1 GB per site); the site
  uses about 430 files.
- **Model weights** (1.1 GB) never go in the deployment. Each visitor's browser downloads them
  from Hugging Face on the landing page and keeps them in its own storage.
- **Caching.** GitHub Pages sets its own short cache, which is fine; Vite fingerprints the files
  under `/assets/`, so a new deploy always loads fresh code.
- **Paths.** `base: './'` makes every URL relative, so the site works at a domain root or under
  a subpath such as `https://user.github.io/repo/`.

### GitHub Pages

`.github/workflows/deploy-pages.yml` builds with `npm ci` and `npm run build`, uploads `dist/` with
`actions/upload-pages-artifact` and publishes it with `actions/deploy-pages`. It is for when
`browser_demo` is the root of its own repository. Once, in the repository: Settings → Pages →
Source: **GitHub Actions**. After that every push to `main` (or a manual run from the Actions tab)
deploys.

## Credits and licenses

- **Base model:** LFM3 1.7B by Liquid AI (LFM Open License).
- **UI components:** shadcn/ui (MIT) and AI Elements (Apache-2.0), copied into `src/components/`
  and adapted (see `src/components/NOTICE.md`); the conversation's loader, trace and generative
  answers are designed after assistant-ui's elements (MIT).
- **Runtime:** webml-community LFM3 WebGPU runtime (Apache-2.0), vendored unchanged from
  https://huggingface.co/spaces/webml-community/LFM3-1.7B-WebGPU-Pi (commit 3ad7ce87).
- **Charts and benchmark:** synthetic, from the fhir-env project. This is a research demo, not
  medical advice.
