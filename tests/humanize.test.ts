// Answer keys as labels (src/app/dom.ts humanize).
import { describe, expect, it } from 'vitest';
import { humanize } from '../src/app/dom.ts';

describe('humanize', () => {
  it('words a key and keeps a trailing unit as written', () => {
    expect(humanize('latest_value')).toBe('Latest value');
    expect(humanize('latestDate')).toBe('Latest date');
    expect(humanize('latest_value_g/dL')).toBe('Latest value (g/dL)');
    expect(humanize('creatinine_mg/dL')).toBe('Creatinine (mg/dL)');
    expect(humanize('change_%')).toBe('Change (%)');
  });
});
