import { describe, expect, it } from 'vitest';
import { compactChart, compactJson, shardRecords } from '../scripts/optimize-data.ts';

describe('lossless production data optimization', () => {
  it('preserves numeric tokens and whitespace inside escaped strings', () => {
    const text = String.raw`{ "float": 13.0, "negative": -0, "large": 9007199254740993, "exponent": 1e-9, "text": "a b\n\" c" }`;
    const compact = compactJson(text);
    expect(compact).toBe(String.raw`{"float":13.0,"negative":-0,"large":9007199254740993,"exponent":1e-9,"text":"a b\n\" c"}`);
    expect(JSON.parse(compact)).toEqual(JSON.parse(text));
  });
  it('removes only exact copies and preserves all remaining numeric tokens', () => {
    const records = shardRecords('{"resources":[{"resourceType":"Observation","id":"a","value":13.0}]}');
    const text = '{"summary":{"value":13.0,"big":9007199254740993},"views":{"Observation/a":{"resource":{"resourceType":"Observation","id":"a","value":13.0},"label":"A"},"Observation/b":{"resource":{"id":"b"}}}}';
    const compact = compactChart(text, records);
    expect(compact).toContain('"value":13.0,"big":9007199254740993');
    expect(JSON.parse(compact).views['Observation/a']).toEqual({ label: 'A' });
    expect(JSON.parse(compact).views['Observation/b'].resource).toEqual({ id: 'b' });
    expect(compactChart(text.replace('"value":13.0},"label"', '"value":13},"label"'), records)).toContain('"value":13}');
  });
});
