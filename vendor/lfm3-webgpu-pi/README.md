---
title: LFM3 WebGPU Workspace
emoji: 💧
colorFrom: blue
colorTo: green
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
short_description: LFM3 coding agent running locally with WebGPU
models:
  - LiquidAI/LFM3-1.7B-GGUF
tags:
  - webgpu
  - gguf
  - text-generation
  - agents
  - just-bash
---

# LFM3 WebGPU Workspace

LFM3-1.7B runs locally in your browser with a terminal, editor, virtual shell,
file tools, and persistent conversations.

## Deploy

Create a **Static Hugging Face Space**, extract this ZIP, and upload its contents
to the repository root. No npm install or build step is required. This README
configures `sdk: static` and `app_file: index.html`.

The root is runnable as-is. `dist/` contains a ready-to-host copy, including its
own README; you can upload those contents instead. Model weights are downloaded
on first use and are not included in the ZIP.

## Run locally

```sh
npm start
```

Requires Node.js 20+ to serve the files. Open http://127.0.0.1:5173 in a
WebGPU-capable browser. Any static server can serve the root or `dist/`.
Use HTTPS for remote hosting; `file://` does not work.

## Model

Choose a quantization in the header or download dialog before loading:

| Choice | File in `LiquidAI/LFM3-1.7B-GGUF` |
| --- | --- |
| **Q4_K_M** (default) | `LFM3-1.7B-Q4_K_M.gguf` |
| **QAD · Q4_0** | `LFM3-1.7B-QAD-Q4_0.gguf` |

The default loads by repository ID; QAD passes its filename through `file`.
The supplied model library includes 17 kernels and 50 variants for these two
files. Reload the page to switch quantization after loading.

**Context defaults to 32,768 tokens**, with up to 4,096 new tokens per reply and
12 agent rounds. The runtime may reduce capacity to fit the device; the terminal
shows the actual capacity after loading. Decoding uses `do_sample: false`.
Settings are in `src/config.js`.

Inference, tools, prompts, and workspace files stay in your browser. Weight
caching is best effort. This is the text-only model; no inference API key is
required.

## Use

- Enter sends; Shift+Enter adds a newline.
- Stop, Escape, or Ctrl+C cancels a running response/tool.
- `/load`, `/new`, `/help`, and `!ls` work in the terminal.
- Read, write, edit, and bash tools use the same virtual filesystem as the editor.
- Import accepts text files; Export downloads a workspace JSON snapshot.
- Files, chats, and the loaded quantization are saved in IndexedDB when available.
- New chat clears conversation history and keeps files.

Try: **Read sales.csv and products.json, calculate total sales revenue, and save
a report.** The starter data totals $144.

The shell provides Bash and text-processing tools. Python, Node.js, npm, native
binaries, and network commands are unavailable. Interrupted partial replies
remain visible but are not included in the model's next prompt. A full context
requires a new chat; history is not silently truncated.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `assets/` | Terminal, editor, layout, and styles. |
| `runtime/Lfm3ForCausalLM.js` | Supplied model library. |
| `runtime/agent.js` | Supplied agent loop. |
| `src/agent.worker.js` | Worker entry point and RPC transport. |
| `src/controller.js` | Loading, streaming, tools, cancellation, and saves. |
| `src/config.js` | Model files, limits, and instructions. |
| `src/model-choice.js` | Quantization selectors. |
| `src/conversation.js` | Pi display-message adapter. |
| `src/workspace.js`, `vendor/just-bash.js` | Virtual filesystem, shell, and persistence. |
| `scripts/` | Optional local server and static build. |
| `test/` | Integration tests. |
| `docs/` | Runtime API and implementation notes. |
| `dist/` | Ready-to-host copy. |
| `licenses/`, `NOTICE`, `LICENSE` | Attribution for included components. |

## Validate

```sh
npm test
npm run build
```

The build copies the app to `dist/`. Tests cover the agent/controller with fake
model sessions and the real shell/worker. Actual WebGPU inference and visual
browser checks remain unverified in this environment.
