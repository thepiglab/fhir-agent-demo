# lfm3-lowbit: the low-bit WebGPU runtime

This runtime is used when `MODEL_RUNTIME` (src/model/config.ts) is `'lowbit'`, or when the page URL has `?runtime=lowbit`. It runs LFM3 GGUFs at 1 to 4 bits per weight (Q1_0, Q2_0, TQ2_0, Q2_K to Q6_K, Q8_0), with the GGUF blocks kept packed in VRAM. It uses core WGSL only, with no f16 and no subgroups, and stays within default browser limits. The vendored runtime (`vendor/lfm3-webgpu-pi`) stays the default for Q4_K_M.

## Files
- `lfm3.js`: the JS host, a drop-in for the part of `Lfm3ForCausalLM` the demo uses: `from_pretrained`, `create_session`, `generate`, `dispose`, and the turn and event shapes. `lfm3.d.ts` types it with the vendored runtime's own session types.
- `pkg/lfm3_web.js` and `pkg/lfm3_web_bg.wasm`: the engine, built with wasm-bindgen `--target web`. It handles GGUF parsing, streamed weight upload, the tokenizer, the chat template and tool-call parser read from the GGUF, the KV prefix reuse, and the GPU sampler (vLLM v1 semantics).

## Source and build
- Source: fhir-env, branch `claude/lowbit-runtime`, folder `lowbit/` (`web/js/lfm3.js` and the `lfm3-web` crate in `web/`).
- Build: `lowbit/build-web.sh` on an HPG node. It compiles `cargo build --release --target wasm32-unknown-unknown -p lfm3-web`, then runs `wasm-bindgen --target web --out-dir web/js/pkg`.
- To update: copy `web/js/lfm3.js` and `web/js/pkg/` here, then note the commit below.

Vendored from: fhir-env `claude/lowbit-runtime` @ 6aa6376. This is the download-stall fix: bounded range requests with retry and resume, byte progress, and abort via `options.signal`. Its wasm is the 58d7203 build, which also has the faster prefill. It was tested in headless Chrome on a B200 against a fault-injecting Range server. sha256:
- `lfm3.js` 6c1fe8cafd39382a5635e59db62ea3ca1f153c02db8fd2a2c3f5633c78a564d9
- `pkg/lfm3_web.js` 7f37b8b3908edcb6a55956843e3630809e5caf42757a80700a8e8ce29f27e3e5
- `pkg/lfm3_web_bg.wasm` f2e07df33b776d115e1fc8e1d8f25ccebda29c772096d6e33c6c367894da0431

Keep `pkg/` next to `lfm3.js`. `init()` resolves the .wasm from `pkg/lfm3_web.js`'s own URL, and Vite emits it as an asset. Pass `wasmUrl` to `from_pretrained` only if the .wasm moves.

## Weights cache
The weights cache is shared with the vendored runtime. It is IndexedDB `gguf-cache-v1`, with store `chunks` keyed `[url, begin, end]` and store `meta` keyed by url. This runtime stores fixed 8 MB blocks; the vendored runtime stores its own ranges. `storedBytes`, `savedModels`, `offload` and `pruneStale` in src/model/model.ts sum `end - begin` per key and delete by url range, so they work for both. Block boundaries differ between the runtimes, so if one URL is loaded by both, offload it before switching runtime.

`model.ts` creates the database at version 2 before this runtime loads, because that is the version the vendored runtime opens. Otherwise this runtime would create version 1, and a later version-2 upgrade could be blocked by its open connection.
