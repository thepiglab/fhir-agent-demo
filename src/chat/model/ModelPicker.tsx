// The model picker: the same agent at 4, 3 and 2 bits and ternary (src/model/catalog.ts). Each option
// shows its download, the GPU memory it needs, a line on quality and the runtime that runs it, and whether
// this browser has it saved (removable one by one). Choosing another option reloads the page with it.
import { useEffect, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { app } from '../../app/state.ts';
import { chooseModel, fmtBytes, fmtSize, optionStates, removeOption } from '../../app/model-gate.ts';
import type { OptionState } from '../../app/model-gate.ts';
import { DEFAULT_MODEL_ID, choosable, uploaded } from '../../model/catalog.ts';
import type { ModelOption } from '../../model/catalog.ts';
import { useModel } from './useModel.ts';

const RUNTIME: Record<ModelOption['runtime'], string> = { vendored: 'standard runtime', lowbit: 'low-bit runtime' };

/** "About 1.3 GB of GPU memory". */
const memoryText = (o: ModelOption): string => `about ${(o.memory.bytes / 1e9).toFixed(1)} GB of GPU memory`;

export function ModelPicker({ className }: { className?: string }) {
  const s = useModel();
  const [states, setStates] = useState<OptionState[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
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
          const canChoose = choosable(o) && !x.current && !busy;
          return (
            <li key={o.id}>
              <div
                role="radio" aria-checked={x.current} aria-disabled={!canChoose && !x.current} tabIndex={canChoose || x.current ? 0 : -1}
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
                  <span className="font-medium">{o.bits}</span>
                  <span className="text-xs text-muted-foreground">{o.quant}</span>
                  <span className="ml-auto flex gap-1">
                    {o.id === DEFAULT_MODEL_ID && <Badge variant="secondary">Recommended</Badge>}
                    {o.experimental && <Badge variant="outline">Experimental</Badge>}
                  </span>
                </div>
                <div className="mt-1 pl-6 text-xs leading-relaxed text-muted-foreground">
                  <div className="tabular-nums">
                    {fmtSize(o.file.bytes)} download · <span title={`Measured: ${o.memory.how}`} className="underline decoration-dotted underline-offset-2">{memoryText(o)}</span> to run · {RUNTIME[o.runtime]}
                  </div>
                  <div>{o.quality}</div>
                  {!uploaded(o) && <div className="text-foreground/70">Not on Hugging Face yet{choosable(o) ? ' (dev server: use ?model= or models/)' : ''}.</div>}
                </div>
              </div>
              {x.stored > 0 && (
                <div className="flex items-center gap-2 pl-9 pt-1 text-xs text-muted-foreground">
                  <span className="mr-auto">Saved in this browser ({fmtBytes(x.stored)})</span>
                  <Button
                    size="xs" variant="ghost" className="text-muted-foreground" disabled={busy || removing !== null}
                    aria-label={`Remove the ${o.bits} model from this browser`}
                    onClick={() => { setRemoving(o.id); void removeOption(o.id, o.bits).finally(() => { setRemoving(null); refresh(); }); }}
                  >
                    <Trash2 />{removing === o.id ? 'Removing…' : 'Remove'}
                  </Button>
                </div>
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
