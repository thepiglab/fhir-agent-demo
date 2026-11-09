# Local patches to `Lfm3ForCausalLM.js`

The file is the supplied minified bundle (webml-community LFM3-1.7B-WebGPU-Pi). No unminified
source is published, so these are small edits to the bundle. Search for `rep.seen`,
`seenT` and `repetition_penalty` to find them. Everything else is as supplied.

## `repetition_penalty` (greedy decode, q6_k head)

Hugging Face / vLLM / llama.cpp semantics: every token in the prompt and in the reply so far has
its logit divided by the penalty when positive and multiplied by it when not. `1` or unset is off.

What the bundle does for our GGUFs (Q4_K_M, tied Q6_K embedding as lm_head): the lm_head
and the argmax are one fused kernel (`LlamaDecodeLmHeadArgmax`, q6_k "ksuper" variant, 512 blocks)
followed by `CandidateArgMax`; no logits ever exist. `SampleNextToken` is not in the bundle at all
(only the call site is), so `do_sample` throws "this model decodes greedily only" and temperature,
top_k and seed are ignored. The patch therefore works in the greedy path.

- **Seen bitmap.** A persistent `uint32[ceil(vocab/32)+1]` state tensor (`cache.repSeen`, bound by
  name `rep.seen` into the decode graph and every prefill graph). The last word holds the penalty as
  f32 bits; 0 (the default) means off.
- **`LlamaDecodeLmHeadArgmax`** gets an optional input `seenT` and a variant `ksuper_seen` (a copy of
  the `ksuper` shader). Before the per-block comparison, a token whose bit is set has its logit
  adjusted. The adjustment is inside the matmul loop, so the argmax sees the penalized logit of
  every vocabulary entry (exact, not a re-rank of per-block winners).
- **`CandidateArgMax`** gets an optional output `seenT` and a variant `reduce_seen`: after it writes
  the chosen token it sets that token's bit. That makes the update GPU-side, so pipelined decode
  (several steps in flight) needs no read-back.
- **Seeding.** `seedRepetition` runs at the start of each generate call's prefill: it rewrites the
  whole bitmap from the full prompt ids (the session passes them, cached prefix included) and the
  penalty word. That resets the bitmap per call and after any cache rewind, and removes tokens
  marked by the discarded first token of the prefix-prefill pass.
- **Options.** `generate(..., { repetition_penalty })` is validated (finite, > 0) in the chat
  session, passed through `streamTokens` to the model. A model whose head is not the single-stage
  q6_k head throws when a penalty other than 1 is asked for. The speculative-decode runner throws too.
- **Off costs nothing measurable:** with the penalty word 0 or 1 the kernel skips the bitmap reads
  (one uniform branch per thread; the extra bitmap binding is always bound).

Types: `Lfm3ForCausalLM.d.ts` (`GenerateOptions.repetition_penalty`).
