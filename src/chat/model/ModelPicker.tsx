// The model picker: the same agent at 4, 3 and 2 bits and ternary (src/model/catalog.ts). Each option
// shows its download, the GPU memory it needs, a line on quality and the runtime that runs it, and whether
// this browser has it saved (removable one by one). Choosing another option reloads the page with it.
import { useEffect, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { app } from '../../app/state.ts';
import { chooseModel, fmtBytes, optionStates, removeOption } from '../../app/model-gate.ts';
import type { OptionState } from '../../app/model-gate.ts';
import { choosable, uploaded } from '../../model/catalog.ts';
import { optionView } from '../../model/option-view.ts';
import { useModel } from './useModel.ts';

export function ModelPicker({ className }: { className?: string }) {
  const s = useModel();
  const [states, setStates] = useState<OptionState[] | null>(null);
  const refresh = () => void optionStates().then(setStates).catch(() => setStates([]));
  useEffect(refresh, [s.state]);

  const busy = s.state === 'loading' || s.state === 'checking' || app.busy;
  if (!states) return <p className={cn('text-xs text-muted-foreground', className)}>Checking which models this browser has…</p>;
  if (!states.length) return null;
  const overridden = !states.some((x) => x.current);

  return (
    <div className={cn('space-y-2', className)}>
      {overridden && <p className="text-xs text-muted-foreground">This page runs the weights named in its address (?model=); choosing a model here replaces them.</p>}
      <ul role="radiogroup" aria-label="Model size" className="space-y-1.5">
        {states.map((x) => {
          const o = x.option;
          const v = optionView(o);
          const canChoose = choosable(o) && !x.current && !busy;
          return (
            <li key={o.id}>
              <div
                role="radio" aria-checked={x.current} aria-label={v.label} aria-describedby={`model-option-${o.id}-details`} aria-disabled={!canChoose && !x.current} tabIndex={canChoose || x.current ? 0 : -1}
                onClick={() => canChoose && chooseModel(o.id)}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && canChoose) { e.preventDefault(); chooseModel(o.id); } }}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  x.current ? 'border-brand bg-brand/5' : canChoose ? 'cursor-pointer hover:bg-muted/60' : 'opacity-60',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', x.current && 'border-brand bg-brand text-white')}>
                    {x.current && <Check className="size-3" />}
                  </span>
                  <span className="font-medium">{v.title}</span>
                  <span className="text-xs text-muted-foreground">{v.quant}</span>
                  <span className="ml-auto flex gap-1">
                    {v.badges.map((b) => (
                      <Badge key={b.label} variant={b.kind === 'recommended' ? 'secondary' : 'outline'} title={b.title} aria-label={b.title ? `${b.label}: ${b.title}` : undefined}>{b.label}</Badge>
                    ))}
                  </span>
                </div>
                <div id={`model-option-${o.id}-details`} className="mt-1 pl-6 text-xs leading-relaxed text-muted-foreground">
                  <div className="tabular-nums">
                    {v.download} download · <span title={v.memoryHow} className="underline decoration-dotted underline-offset-2">{v.memory}</span> to run · {v.runtime}
                  </div>
                  <div>
                    {v.qualityNote
                      ? <span title={v.qualityNote} className="underline decoration-dotted underline-offset-2">{v.quality}</span>
                      : v.quality}
                  </div>
                  {v.qualityNote && <div className="sr-only">{v.qualityNote}</div>}
                  {!uploaded(o) && <div className="text-foreground/70">Not on Hugging Face yet{choosable(o) ? ' (dev server: use ?model= or models/)' : ''}.</div>}
                </div>
              </div>
              {x.stored > 0 && (
                <div className="pl-9 pt-1 text-xs text-muted-foreground">Saved in this browser ({fmtBytes(x.stored)})</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Memory is GPU memory while the model runs (on Macs, shared with the rest of the system); the browser needs some more on top. Choosing a model reloads the page.
      </p>
    </div>
  );
}

/**
 * Manage storage: every model saved in this browser, with its size and a Remove that asks first and then
 * says how much was freed. Removing the model in use unloads it.
 */
export function StorageManager({ className }: { className?: string }) {
  const s = useModel();
  const [states, setStates] = useState<OptionState[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const refresh = () => void optionStates().then(setStates).catch(() => setStates([]));
  useEffect(refresh, [s.state]);
  const busy = s.state === 'loading' || s.state === 'checking' || app.busy;
  if (!states) return <p className={cn('text-xs text-muted-foreground', className)}>Checking this browser’s storage…</p>;
  const saved = states.filter((x) => x.stored > 0);
  const total = saved.reduce((a, x) => a + x.stored, 0);
  return (
    <div className={cn('space-y-2 text-xs', className)}>
      {saved.length === 0
        ? <p className="text-muted-foreground">No models are saved in this browser.</p>
        : <p className="text-muted-foreground">{saved.length === 1 ? 'One model' : `${saved.length} models`} saved here, {fmtBytes(total)} in all.</p>}
      <ul className="space-y-1">
        {saved.map((x) => {
          const v = optionView(x.option);
          return (
            <li key={x.option.id} className="flex min-h-8 items-center gap-2">
              {confirming === x.option.id ? (
                <>
                  <span className="mr-auto">Remove {v.title} ({fmtBytes(x.stored)}){x.current ? ' and unload it' : ''}?</span>
                  <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button>
                  <Button size="xs" variant="destructive" disabled={removing !== null}
                    onClick={() => {
                      setRemoving(x.option.id);
                      void removeOption(x.option.id, v.title)
                        .then(() => setDone(`Removed ${v.title}: ${fmtBytes(x.stored)} freed.`))
                        .finally(() => { setRemoving(null); setConfirming(null); refresh(); });
                    }}>
                    {removing === x.option.id ? 'Removing…' : 'Remove'}
                  </Button>
                </>
              ) : (
                <>
                  <span className="mr-auto"><span className="font-medium text-foreground">{v.title}</span> <span className="text-muted-foreground">{fmtBytes(x.stored)}{x.current ? ' · in use' : ''}</span></span>
                  <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy || removing !== null}
                    aria-label={`Remove the ${v.title} model from this browser`} onClick={() => { setDone(null); setConfirming(x.option.id); }}>
                    <Trash2 />Remove
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {done && <p role="status" className="text-muted-foreground">{done}</p>}
    </div>
  );
}
