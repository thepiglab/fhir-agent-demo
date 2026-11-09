// Per-turn limits on the model's thinking, in place of the repetition penalty the RL evals ran
// with (eval preset: temperature 0.1, top_k 50, repetition penalty 1.1). The vendored WebGPU
// runtime picks the next token inside a fused lm_head on the GPU (top-k candidates per block, then
// a draw), so no logits reach JavaScript to penalise; a penalty would mean changing its kernels.
// Without it, the trained models can loop in their thinking (one LOINC code repeated until the
// reply cap, as on the HbA1c example). So each turn is watched:
//  - a thinking budget: past THINKING_BUDGET reasoning tokens the turn is cancelled;
//  - a loop guard: when the thinking's tail is one short piece repeated LOOP_REPEATS times in a
//    row, the turn is cancelled at once (a loop never recovers, and every token costs time);
//  - a sentence-loop guard, for loops that repeat a whole sentence with small changes ("Let's try
//    Task?identifier=DUP-… with ?identifier=DUP-…" over and over, RL L step 200), which the exact
//    80-character match misses. Such a loop cycles through a block of several sentences, so each
//    new sentence is compared with the turn's earlier ones: it is a repeat when one of them is
//    near-identical (token Jaccard >= SENTENCE_JACCARD, ids masked), and when SENTENCE_SIMILAR of
//    the last SENTENCE_WINDOW sentences are repeats, the turn is cancelled.
// Either ends the run cleanly with no answer and a plain reason (trace.stop_reason, trace.error).

/** Reasoning tokens one turn may spend (the reply cap is 2,048 tokens, thinking included). */
export const THINKING_BUDGET = 1536;
/** A piece of 2 to 80 characters, repeated this many times in a row at the end of the thinking. */
export const LOOP_REPEATS = 8;
const TAIL = 1200;
/** Longer reasoning events are buffered chunks, not single tokens (single tokens seen: up to 16 characters). */
const CHUNK_CHARS = 16;
const MIN_LOOP_CHARS = 48;
const LOOP = new RegExp(`([\\s\\S]{2,80}?)\\1{${LOOP_REPEATS - 1},}$`);

/** Sentence loops: this many of the last SENTENCE_WINDOW sentences repeat an earlier one. */
// Tuned on recorded thinking (2026-11-09: RL L step 200, SFT v0.6.1 L, SFT v0.5.1; 21 runs each).
// 4 of 6 at 0.8 also stopped RL runs that dithered ("We already did.") and then recovered with a
// correct answer; 8 of 10 at 0.9 stops only the loops that never recovered.
export const SENTENCE_WINDOW = 10;
export const SENTENCE_SIMILAR = 8;
export const SENTENCE_JACCARD = 0.9;
/** How many of the turn's earlier sentences a new one is compared with. */
const SENTENCE_HISTORY = 40;
/** Shorter sentences ("Let's try.", "Could be unsupported.") are skipped: too little to compare. */
const MIN_SENTENCE_TOKENS = 4;
/** A sentence ends at . ? or ! followed by white space, or at a line break ("Task?identifier=" doesn't end one). */
const SENTENCE_END = /[.?!](?=\s)|\n/g;

/**
 * A sentence's words for comparison: lowercased, split on anything not a letter or digit, with ids
 * masked (a token mixing letters and digits, such as a6f0fb23, or 6+ digits) so one search retried
 * on another id still matches. Short numbers stay: masking them would make a list of lab values
 * ("2021-07-25: 11.6 g/dL" line after line) look like a loop.
 */
export function sentenceTokens(sentence: string): Set<string> {
  const out = new Set<string>();
  for (const t of sentence.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!t) continue;
    out.add((/[a-z]/.test(t) && /[0-9]/.test(t)) || /^[0-9]{6,}$/.test(t) ? '#id' : t);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}

/** True when the sentence is near-identical to one of the earlier ones. */
export function repeats(words: Set<string>, earlier: Set<string>[]): boolean {
  return earlier.some((e) => jaccard(words, e) >= SENTENCE_JACCARD);
}

export type GuardStop = 'thinking_budget' | 'thinking_loop';

export const GUARD_TEXT: Record<GuardStop, string> = {
  thinking_budget: 'The model ran out of its thinking budget for this step before answering. Try asking a narrower question.',
  thinking_loop: 'The model started repeating itself while thinking, so this run was stopped. Try rephrasing the question.',
};

/** Watches one turn's stream: feed each reasoning piece; returns why to stop, or null. */
export function thinkingGuard(budget = THINKING_BUDGET): { feed(text: string): GuardStop | null; tokens(): number } {
  let tokens = 0;
  let tail = '';
  let checked = 0;
  let pending = '';              // the sentence being written
  const history: Set<string>[] = [];  // the turn's last SENTENCE_HISTORY sentences, as tokens
  const flags: boolean[] = [];        // for the last SENTENCE_WINDOW sentences: a repeat?
  return {
    feed(text: string): GuardStop | null {
      // The runtime streams one reasoning event per token, but after a quote it can hold text back
      // and release it as one chunk (8,028 characters seen from SFT v0.6.1): count a chunk by its
      // length (about 4 characters a token) so it can't slip past the budget as one token.
      tokens += text.length > CHUNK_CHARS ? Math.ceil(text.length / 4) : 1;
      tail = (tail + text).slice(-TAIL);
      if (tokens > budget) return 'thinking_budget';
      pending += text;
      let end = -1;
      for (const m of pending.matchAll(SENTENCE_END)) end = m.index! + 1;
      if (end > 0) {
        for (const sentence of pending.slice(0, end).split(SENTENCE_END)) {
          const words = sentenceTokens(sentence);
          if (words.size < MIN_SENTENCE_TOKENS) continue;
          flags.push(repeats(words, history));
          if (flags.length > SENTENCE_WINDOW) flags.shift();
          history.push(words);
          if (history.length > SENTENCE_HISTORY) history.shift();
        }
        pending = pending.slice(end);
        if (flags.filter(Boolean).length >= SENTENCE_SIMILAR) return 'thinking_loop';
      }
      // The regex is cheap on 1,200 characters, but needs no running on every token.
      if (tokens - checked >= 8) {
        checked = tokens;
        // A run of one character or a short id ("0000…", "====") is not a loop: the repeats must
        // span at least MIN_LOOP_CHARS.
        const m = LOOP.exec(tail.trimEnd());
        if (m && m[0].length >= MIN_LOOP_CHARS) return 'thinking_loop';
      }
      return null;
    },
    tokens: () => tokens,
  };
}
