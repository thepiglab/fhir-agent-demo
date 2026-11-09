// React access to the shared app store (src/app/state.ts). The store stays framework-free (the
// chart panel and the model host are plain TypeScript); components re-render on its events.
import { useEffect, useReducer } from 'react';
import { app, on } from '../app/state.ts';
import type { Events } from '../app/state.ts';

const ALL: (keyof Events)[] = ['ready', 'patient', 'mode', 'question', 'model', 'dev', 'busy', 'sandbox', 'panel', 'openRecord', 'compose'];

/** The live `app` object; the component re-renders when any of `events` fires (default: all). */
export function useApp(events: (keyof Events)[] = ALL): typeof app {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const offs = events.map((name) => on(name, () => bump()));
    return () => { for (const off of offs) off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.join()]);
  return app;
}

/** Subscribe to one event for the component's lifetime. */
export function useEvent<K extends keyof Events>(name: K, handler: (value: Events[K]) => void): void {
  useEffect(() => on(name, handler), [name, handler]);
}
