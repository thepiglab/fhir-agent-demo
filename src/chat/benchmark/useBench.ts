// Re-render when the benchmark picking state (logic.ts) or the chosen question changes.
import { useEffect, useReducer } from 'react';
import { onBench, bench } from './logic.ts';
import { useApp } from '../store.ts';

export function useBench(): typeof bench {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onBench(bump), []);
  useApp(['question', 'patient', 'mode', 'ready', 'busy', 'dev']);
  return bench;
}
