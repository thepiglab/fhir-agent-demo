// The browser's LFM3 token count (src/fhir/tokenizer.ts) against HF tokenizers 0.23.3 on the same
// tokenizer.json: tokenizer-golden.jsonl.gz (scripts/web_demo/make_tokenizer_golden.py) holds
// edge cases and every message text of a sample of X16 contexts, with len(encode(text).ids).
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Lfm3Tokenizer } from '../../src/fhir/tokenizer.ts';

const DATA = new URL('../../public/data/tokenizer/', import.meta.url);
const GOLDEN = new URL('tokenizer-golden.jsonl.gz', import.meta.url);
const ready = existsSync(new URL('vocab.json', DATA)) && existsSync(GOLDEN);

describe.skipIf(!ready)('LFM3 token counts', () => {
  it('equal HF tokenizers on every golden text', () => {
    const read = (name: string) => JSON.parse(readFileSync(new URL(name, DATA), 'utf8'));
    const tok = new Lfm3Tokenizer({ vocab: read('vocab.json'), merges: read('merges.json'), added: read('added.json') });
    const rows = gunzipSync(readFileSync(GOLDEN)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { text: string; count: number });
    const bad = rows.filter((r) => tok.count(r.text) !== r.count).map((r) => `${JSON.stringify(r.text.slice(0, 80))}: python ${r.count} ts ${tok.count(r.text)}`);
    if (bad.length) console.log(bad.slice(0, 15).join('\n'));
    expect(rows.length).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  }, 300_000);
});
