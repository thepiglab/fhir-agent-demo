// Hosts the plain-TypeScript chart panel (src/app/chart-panel.ts renders into aside#chart-panel)
// and lays it out: a 440px column beside the conversation on desktop (≥1100px), a drawer over the
// conversation with a dim backdrop on tablets (641–1099px), a full-screen sheet on phones (≤640px).
import { useEffect, useLayoutEffect } from 'react';
import { cn } from '@/lib/utils';
import { init } from '../../app/chart-panel.ts';
import { app, setPanel } from '../../app/state.ts';
import { storage } from '../../app/dom.ts';
import { useApp } from '../store.ts';

const wide = window.matchMedia('(min-width: 1100px)');
// On a tablet or phone the panel covers the conversation: start closed there. Decided before the
// first render (no flash); the desktop preference that setPanel stores is put back on mount.
const desktopPref = app.panelOpen;
if (!wide.matches && app.panelOpen) {
  app.panelOpen = false;
  document.body.classList.remove('panel-open');
}

let started = false;
export function ChartPanelHost() {
  const { panelOpen: open } = useApp(['panel']);
  useLayoutEffect(() => {
    if (started) return;
    started = true;
    if (desktopPref && !wide.matches) storage.set('panel-open', true);
    init();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !app.panelOpen || wide.matches) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
      setPanel(false);
      document.getElementById('chart-toggle')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* Tablet: a dim backdrop over the conversation that closes the drawer. */}
      <div
        aria-hidden="true"
        onClick={() => setPanel(false)}
        className={cn(
          'fixed inset-x-0 top-14 bottom-0 z-30 bg-black/30 transition-opacity duration-200 min-[1100px]:hidden max-[640px]:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      {/* Desktop: this wrapper animates its width; below 1100px it steps aside (display: contents). */}
      <div
        className={cn(
          'relative shrink-0 overflow-hidden transition-[width] duration-200 ease-out max-[1099px]:contents',
          open ? 'w-[440px]' : 'w-0',
        )}
      >
        <aside
          id="chart-panel"
          aria-label="Patient chart"
          inert={!open}
          className={cn(
            'flex flex-col bg-background',
            // desktop column
            'min-[1100px]:absolute min-[1100px]:inset-y-0 min-[1100px]:left-0 min-[1100px]:w-[440px] min-[1100px]:border-l',
            // tablet drawer
            'max-[1099px]:fixed max-[1099px]:top-14 max-[1099px]:right-0 max-[1099px]:bottom-0 max-[1099px]:z-40 max-[1099px]:w-[440px] max-[1099px]:max-w-full max-[1099px]:border-l max-[1099px]:shadow-xl',
            'max-[1099px]:transition-[translate,visibility] max-[1099px]:duration-200 max-[1099px]:ease-out',
            // phone sheet
            'max-[640px]:top-0 max-[640px]:z-50 max-[640px]:w-full max-[640px]:border-l-0 max-[640px]:shadow-none',
            open ? 'max-[1099px]:translate-x-0' : 'max-[1099px]:invisible max-[1099px]:translate-x-full',
          )}
        />
      </div>
    </>
  );
}
