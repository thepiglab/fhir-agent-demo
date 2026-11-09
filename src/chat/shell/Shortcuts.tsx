// App-wide keyboard shortcuts and the two dialogs they open: ⌘K (Ctrl+K) opens the benchmark
// question browser from anywhere, and ? opens the list of shortcuts. Both dialogs are mounted once
// here, so the Browse button and the top bar's help button open the same instances.
import { useEffect, useState } from 'react';
import { CircleQuestionMark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { app, setPanel } from '../../app/state.ts';
import { QuestionBrowser } from '../benchmark/QuestionBrowser.tsx';

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

type Which = 'browser' | 'help' | null;
const listeners = new Set<(w: Which) => void>();
const show = (w: Which): void => { for (const fn of listeners) fn(w); };
/** Open the benchmark question browser (the Browse button, ⌘K). */
export const openQuestionBrowser = (): void => show('browser');
/** Open the keyboard shortcuts list (the top bar's ? button, the ? key). */
export const openShortcuts = (): void => show('help');

/** Typing in a field: plain-key shortcuts (?) stay out of the way. */
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'K'], label: 'Browse benchmark questions' },
  { keys: [MOD, 'B'], label: 'Toggle chart panel' },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
  { keys: ['Enter'], label: 'Send the question' },
  { keys: ['Shift', 'Enter'], label: 'New line in the question' },
  { keys: ['↑', '↓'], label: 'Move through a list' },
  { keys: ['Esc'], label: 'Close a dialog or the chart panel' },
];

/** The two dialogs and the global key handler; mount once. */
export function GlobalDialogs() {
  const [open, setOpen] = useState<Which>(null);
  useEffect(() => {
    listeners.add(setOpen);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if (app.busy) return;  // choosing a question switches patient: not mid-run
        e.preventDefault();
        setOpen((o) => (o === 'browser' ? null : 'browser'));
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setPanel(!app.panelOpen);
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        setOpen((o) => (o === 'help' ? null : 'help'));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { listeners.delete(setOpen); document.removeEventListener('keydown', onKey); };
  }, []);
  const close = (o: boolean) => { if (!o) setOpen(null); };
  return (
    <>
      <QuestionBrowser open={open === 'browser'} onOpenChange={close} />
      <Dialog open={open === 'help'} onOpenChange={close}>
        <DialogContent className="gap-0 p-0 sm:max-w-sm">
          <div className="px-5 pt-5 pb-3">
            <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
            <DialogDescription className="sr-only">Keys that work anywhere in the demo.</DialogDescription>
          </div>
          <ul className="px-5 pb-5">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 border-t py-2.5 text-sm first:border-t-0">
                <span>{s.label}</span>
                <KbdGroup>{s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</KbdGroup>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The top bar's help button. */
export function ShortcutsButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="Keyboard shortcuts" onClick={openShortcuts}>
          <CircleQuestionMark />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Keyboard shortcuts <Kbd>?</Kbd></TooltipContent>
    </Tooltip>
  );
}
