// LFM3's tokenizer, for counting tokens as harness X16v2 does (tokenizers.Tokenizer.encode on
// LiquidAI/LFM3-1.7B's tokenizer.json, sha256 7e226e34bface23c…, exported to public/data/tokenizer/
// by the fhir-env repo's scripts/web_demo/export_tokenizer.py). Only the count is needed, but the
// pipeline is HF tokenizers' own:
//   1. added tokens (<|im_start|> and the like) split out, leftmost-longest, one token each;
//   2. pre-tokenizer Split(regex, Isolated) then ByteLevel(add_prefix_space=false, use_regex=false);
//   3. BPE with ignore_merges (a piece already in the vocabulary is one token), lowest rank first;
//   4. no normalizer; the ByteLevel post-processor adds no tokens.
// tests/parity/tokenizer.test.ts checks counts against Python tokenizers 0.23.3.
// The X16v2 RL run counts with the SFT v0.6.1-X16 checkpoint's tokenizer.json (sha256 41927bd3…,
// /blue/cai5724/wkieffer/fhir/sft/sft-v0.6.1-x16-natural022-20261107-195916Z-lfm3-1.7b/sft/model/):
// the same vocabulary, merges, added tokens and pipeline, formatted differently; it gives the same
// count on every golden text.
import { fetchDataJson } from '../app/datafile.ts';

/** GPT-2's bytes_to_unicode: every byte as a printable character. */
const BYTE_CHAR: string[] = (() => {
  const keep: number[] = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  const out: string[] = new Array(256);
  let extra = 0;
  for (let b = 0; b < 256; b++) out[b] = String.fromCodePoint(keep.includes(b) ? b : 256 + extra++);
  return out;
})();

// The Split pre-tokenizer's pattern, written for JavaScript with the same meaning as Rust's regex:
// (?i:'s|'t|...) spelled out case by case, and \s as Unicode White_Space.
const S = '\\p{White_Space}';
const SPLIT = new RegExp(
  `'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])`
  + `|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+`
  + `|\\p{N}{1,3}`
  + `| ?[^${S}\\p{L}\\p{N}]+[\\r\\n]*`
  + `|[${S}]*[\\r\\n]+`
  + `|[${S}]+(?![^${S}])`
  + `|[${S}]+`,
  'gu',
);

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export interface TokenizerData { vocab: string[]; merges: string[]; added: { id: number; content: string; special: boolean }[] }

export class Lfm3Tokenizer {
  private vocab: Set<string>;
  private ranks: Map<string, number>;
  private addedPattern: RegExp | null;
  private cache = new Map<string, number>();
  private encoder = new TextEncoder();

  constructor(data: TokenizerData) {
    this.vocab = new Set(data.vocab);
    this.ranks = new Map(data.merges.map((m, i) => [m, i]));
    const added = [...new Set(data.added.map((a) => a.content))].sort((a, b) => b.length - a.length);
    this.addedPattern = added.length ? new RegExp(added.map(escapeRegex).join('|'), 'gu') : null;
  }

  /** len(tokenizer.encode(text).ids). */
  count(text: string): number {
    if (!text) return 0;
    let total = 0, last = 0;
    if (this.addedPattern) {
      this.addedPattern.lastIndex = 0;
      for (const m of text.matchAll(this.addedPattern)) {
        total += this.countPlain(text.slice(last, m.index)) + 1;
        last = m.index + m[0].length;
      }
    }
    return total + this.countPlain(text.slice(last));
  }

  private countPlain(text: string): number {
    let total = 0, last = 0;
    SPLIT.lastIndex = 0;
    for (const m of text.matchAll(SPLIT)) {
      if (m.index > last) total += this.countPiece(text.slice(last, m.index));  // Isolated: gaps are pieces too
      total += this.countPiece(m[0]);
      last = m.index + m[0].length;
    }
    if (last < text.length) total += this.countPiece(text.slice(last));
    return total;
  }

  private countPiece(piece: string): number {
    if (!piece) return 0;
    const cached = this.cache.get(piece);
    if (cached !== undefined) return cached;
    const symbols = Array.from(this.encoder.encode(piece), (b) => BYTE_CHAR[b]!);
    const word = symbols.join('');
    let n: number;
    if (this.vocab.has(word)) n = 1;  // ignore_merges
    else {
      for (;;) {
        let best = -1, bestRank = Infinity;
        for (let i = 0; i < symbols.length - 1; i++) {
          const rank = this.ranks.get(symbols[i] + ' ' + symbols[i + 1]);
          if (rank !== undefined && rank < bestRank) { bestRank = rank; best = i; }
        }
        if (best < 0) break;
        const a = symbols[best]!, b = symbols[best + 1]!;
        const merged: string[] = [];
        for (let i = 0; i < symbols.length;) {
          if (i < symbols.length - 1 && symbols[i] === a && symbols[i + 1] === b) { merged.push(a + b); i += 2; }
          else { merged.push(symbols[i]!); i += 1; }
        }
        symbols.splice(0, symbols.length, ...merged);
      }
      n = symbols.length;
    }
    if (this.cache.size < 200_000) this.cache.set(piece, n);
    return n;
  }
}

let shared: Promise<Lfm3Tokenizer> | null = null;
/** The tokenizer, loaded once from public/data/tokenizer/ (about 5.5 MB, 1.8 MB compressed). */
export function loadTokenizer(base: string | URL): Promise<Lfm3Tokenizer> {
  if (!shared) {
    const get = <T>(name: string) => fetchDataJson<T>(new URL(name, base));
    shared = Promise.all([get<string[]>('vocab.json'), get<string[]>('merges.json'), get<TokenizerData['added']>('added.json')])
      .then(([vocab, merges, added]) => new Lfm3Tokenizer({ vocab, merges, added }));
    shared.catch(() => { shared = null; });
  }
  return shared;
}
