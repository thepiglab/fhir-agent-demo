# Local patches to `Lfm3ForCausalLM.js`

The file is the supplied minified bundle (webml-community LFM3-1.7B-WebGPU-Pi). No unminified
source is published, so these are edits to the bundle. Search for `rep.seen`, `seenT`,
`SampleTopKMerge`, `adjust_logit`, `sample_pick` and `seedSampling` to find them. Everything else
is as supplied. Tests: `scripts/sampler_check_page.ts` and `scripts/parity/` (see the research
note `docs/research/webgpu-repetition-penalty.md`).

## A GPU sampler with vLLM's semantics

As supplied, the bundle could not sample our GGUFs. Q4_K_M has a tied Q6_K embedding as lm_head, and
the bundle fuses that head with the argmax (`LlamaDecodeLmHeadArgmax`, q6_k "ksuper" variant, 512
blocks, then `CandidateArgMax`), so no logits ever exist. `SampleNextToken` is referenced but has no
kernel, and `do_sample` threw "this model decodes greedily only". The demo therefore always decoded
greedily, whatever temperature it passed.

The patch keeps the fused head and adds, all on the GPU, with no read-back:

| option | semantics (as vLLM 0.32, v1 sampler) |
|---|---|
| `logit_bias` | token id -> bias added to its logit, clamped to [-100, 100] |
| `min_tokens` | the stop tokens (EOS ids, up to 4) are masked until this many new tokens |
| `repetition_penalty` | over prompt + output tokens: logit > 0 divided, else multiplied; 1 = off |
| `frequency_penalty` | minus penalty x count, over this reply's tokens only; [-2, 2] |
| `presence_penalty` | minus penalty once per token in this reply; [-2, 2] |
| `temperature` | logits / T; 0 = greedy (argmax of the adjusted logits) |
| `min_p` | drop tokens with p < min_p x p_max (after temperature) |
| `top_k` | 1 to 64; unset, 0 or -1 = all 64 candidates |
| `top_p` | keep the smallest top set whose cumulative probability reaches top_p (vLLM's ascending-cumsum rule) |
| `seed` | per-request; the draw for the n-th token is a PCG hash of (seed, n), so a seed reproduces exactly |

Order, as vLLM: logit_bias and min_tokens -> repetition -> frequency -> presence -> temperature -> min_p
-> top_k -> top_p -> draw. Passing temperature, top_k, top_p or min_p turns sampling on (the bundle's
own rule was to sample only with `do_sample`). Temperature 0 or top_k 1 stays on the greedy path.

### How

- **One state buffer per generation cache** (`cache.repSeen`, bound by name `rep.seen` into the decode
  graph and every prefill graph). With W = ceil(vocab / 32), the u32 words are:
  - `[0, W)` the seen bitmap (prompt + output);
  - `W + 0..15` a header: repetition, top_k (0 = greedy), temperature, top_p, min_p, seed, tokens
    generated, flags, frequency, presence, min_tokens, then the stop-id count and up to 4 stop ids;
  - `[W+16, W+16+32W)` output-token counts;
  - `[W+16+32W, W+16+64W)` the logit bias (f32);
  - `[65W+16, 65W+144)` the 64 logits and ids the last sampled token was drawn from (for tests).

  `seedSampling` rewrites the bitmap and header at the start of every generate call, from the full
  prompt ids. The session passes the whole rendered conversation, cached prefix included, so earlier
  turns and tool results count as prompt. It zeroes the counts and bias only when they are or were in
  use. That makes each call one vLLM request, and resets the state after any cache rewind.
- **True logits.** The supplied head leaves out the final RMSNorm's 1/rms: a positive scale that
  doesn't change an argmax, but it is wrong for sampling (an effective temperature about 4 to 5 times
  too high) and for additive adjustments. Each head workgroup now reduces the hidden state's sum of
  squares and scales by 1/sqrt(mean + eps) whenever sampling, presence, frequency or bias is on. Plain
  and repetition-only greedy keep the raw values, so they stay bit-identical to the supplied path.
- **Head kernel** (`ksuper_seen`, a copy of the q6_k `ksuper` shader): `adjust_logit` applies bias,
  min_tokens, repetition, frequency and presence to every vocabulary entry inside the matmul loop.
  With the sampling flag off, the block keeps its argmax (the supplied tree reduction, bit for bit).
  With it on, the block bitonic-sorts its 256 adjusted logits and writes its top 64.
- **`SampleTopKMerge`** (new op, one workgroup): a 64-step merge of the 512 sorted block lists into
  the exact global top-64, then `sample_pick` (temperature, min_p, top_k, top_p, draw) on thread 0. It
  writes the token and notes it: bitmap bit, count, and the counter that min_tokens and the RNG use.
  With the flag off it returns at once.
- **`CandidateArgMax`** (`reduce_seen` variant): with the flag off it writes and notes the greedy token;
  with it on it leaves the token to the merge.
- The prefill graph's last row goes through the same head, so the first token is sampled too.

### Exactness and bounds

- **The candidate list is exact.** Each of the 512 head blocks covers one vocabulary tile of 256
  entries (512 x 256 >= 128,000; each thread holds one entry), sorts all 256 and keeps its top 64. So
  the merged top-64 is the exact top-64 of the adjusted logits (ties: lower token id first).
- **The bound:** sampling sees at most the top 64 tokens. With top_k <= 64 that is exact. With top_k
  unset (vLLM: the whole vocabulary), top_p and min_p act on the top 64 only, which drops the mass
  beyond rank 64. For SFT v0.6.1 L at T 1 that mass was 0.00014 on a paragraph prompt and 0.036 on
  "name one animal". It grows with temperature, and at T 0.1 it is nil.
- **Deviations:**
  - vLLM keeps all tokens tied at the k-th logit; this keeps exactly k.
  - Stop strings are not held back by min_tokens; only stop token ids are.
  - Random numbers differ from vLLM's torch generator, so the same seed gives a different but
    equally distributed sample.
  - Greedy is the argmax of the same adjusted logits, as vLLM's `temperature < 1e-5` path.
- **Not implemented:** typical_p (vLLM has none), repeat_last_n windows (llama.cpp only), mirostat,
  DRY, XTC, bad_words / allowed_token_ids.
- **llama.cpp differs:** its frequency and presence penalties count prompt tokens too, inside a
  `repeat_last_n` window.
- **Supported head:** only the single-stage q6_k head (all our GGUFs). Asking for any sampling or
  penalty on another head (Q4_0 QAD, two-stage scan + rescore, Q1, Q8 rows) throws, rather than
  silently decoding greedily. The speculative-decode runner throws too.

### Cost

On an M1 Max (Chrome, v0.6.1, 300 new tokens): greedy is 139.7 tok/s against 139.5 before the patch;
everything on is 1.3 to 1.6% slower. Greedy pays one early-exit dispatch per token and a 2,048-element
reduction per head block. Numbers are in `docs/research/webgpu-sampler.md`.

### Test hook

Inert unless a page sets `globalThis.__lfm3SamplingDebug = {}`. Then each generate stores the
prompt ids, output ids and the state tensor there, for `scripts/sampler_check_page.ts`.

Types: `Lfm3ForCausalLM.d.ts` (`GenerateOptions`).
