// React access to runs, threads and chart records.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, emit, on, setPanel } from '../../app/state.ts';
import { replay, session, threadStore } from './run.ts';
import type { Run } from './run.ts';

/** Re-render when the run changes; returns its version (use it as a memo key). */
export function useRun(run: Run): number {
  return useSyncExternalStore(run.subscribe, () => run.version);
}

export function useThread(patient: string | undefined): Run[] {
  useSyncExternalStore(threadStore.subscribe, threadStore.version);
  return threadStore.runs(patient);
}

/** Open a record in the chart panel. */
export function openRecord(ref: string): void {
  setPanel(true);
  emit('openRecord', ref);
}

// ---------- records (the chart's view of one reference, /api/resource) ----------
export interface RecordView {
  ref: string;
  type: string | null;
  date: string | null;
  label: string;
  status: string;
  resource: Record<string, unknown> | null;
}
const records = new Map<string, Promise<RecordView | null>>();
on('sandbox', ({ patient }) => {
  for (const key of records.keys()) if (key.startsWith(patient + ' ')) records.delete(key);
});
export function fetchRecord(patient: string, ref: string): Promise<RecordView | null> {
  const key = `${patient} ${ref}`;
  let found = records.get(key);
  if (!found) {
    found = api<RecordView>('/api/resource', { session, patient, ref }).catch(() => null);
    records.set(key, found);
  }
  return found;
}

/** The records for these references (null until loaded; missing ones are left out). */
export function useRecords(patient: string, refs: string[]): Map<string, RecordView> | null {
  const key = refs.join(' ');
  const [state, setState] = useState<{ key: string; map: Map<string, RecordView> } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(refs.map((ref) => fetchRecord(patient, ref))).then((list) => {
      if (!live) return;
      setState({ key, map: new Map(list.flatMap((r) => (r ? [[r.ref, r] as const] : []))) });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient, key]);
  return state && state.key === key ? state.map : null;
}

// ---------- suggestions (/api/summary) ----------
export interface Suggestion { voice: string; question: string }
const suggestions = new Map<string, Promise<Suggestion[]>>();
export function suggestionsFor(patient: string): Promise<Suggestion[]> {
  let found = suggestions.get(patient);
  if (!found) {
    found = api<{ suggestions?: Suggestion[] }>('/api/summary', { session, patient }).then((s) => s.suggestions ?? []).catch(() => []);
    suggestions.set(patient, found);
  }
  return found;
}

/** Development aid: replay recorded stream events into the thread (no model needed). */
if (import.meta.env.DEV) (window as unknown as { __replay?: typeof replay }).__replay = replay;
