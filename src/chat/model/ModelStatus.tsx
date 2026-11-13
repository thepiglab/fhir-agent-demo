// The model's status in the top bar: plain text with a small dot ("Ready", "Loading 42%",
// "Model not downloaded"); clicking it opens the model's details in a popover.
import { useEffect, useState } from 'react';
import { ChevronRight, Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MODEL_FACTS } from '../../model/config.ts';
import type { ModelStatus as Status } from '../../app/state.ts';
import { app } from '../../app/state.ts';
import {
  deviceChecks, download, fmtBytes, host, loadOrigin, modelBytes, percent, progressView, removeModel, removeOlder, storedBytes, versionInfo,
} from '../../app/model-gate.ts';
import type { DeviceCheck } from '../../app/model-gate.ts';
import { useModel } from './useModel.ts';
import { LocalFile, ProgressBar } from './parts.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { DotMatrix } from '../conversation/DotMatrix.tsx';

function statusText(s: Status): { text: string; dot: string; pulse: boolean } {
  switch (s.state) {
    case 'checking': return { text: 'Checking model', dot: 'bg-muted-foreground/50', pulse: true };
    case 'absent': return { text: 'Model not downloaded', dot: 'bg-muted-foreground/50', pulse: false };
    case 'loading': {
      const p = percent(s);
      return { text: `${s.phase === 'gpu' ? 'Preparing' : 'Loading'}${p === null ? '…' : ` ${p.toFixed(0)}%`}`, dot: 'bg-brand', pulse: true };
    }
    case 'ready': return { text: 'Ready', dot: 'bg-success', pulse: false };
    case 'unsupported': return { text: 'No WebGPU', dot: 'bg-destructive', pulse: false };
    case 'error': return { text: 'Model error', dot: 'bg-destructive', pulse: false };
  }
}

export function ModelStatusButton() {
  const s = useModel();
  const { text, dot, pulse } = statusText(s);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-2 rounded-full px-2.5 font-normal text-muted-foreground hover:text-foreground" aria-label={`Model: ${text}. Details`}>
              {pulse
                ? <DotMatrix className="size-3 [&>span]:size-[2.5px]" />
                : <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dot)} />}
              <span className="tabular-nums max-[640px]:sr-only">{text}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Model status and storage</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={8} className="max-h-[min(42rem,calc(100dvh-5rem))] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto p-0">
        <ModelDetails status={s} />
      </PopoverContent>
    </Popover>
  );
}

const ROW = 'flex justify-between gap-4 py-1.5 text-sm';

function ModelDetails({ status: s }: { status: Status }) {
  const [stored, setStored] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [checks, setChecks] = useState<DeviceCheck[] | null>(null);
  const [checksError, setChecksError] = useState<string | null>(null);
  const [removingOlder, setRemovingOlder] = useState(false);
  const { current, older, latest } = versionInfo();

  useEffect(() => { void storedBytes().then(setStored).catch(() => {}); }, [s.state]);

  const busy = s.state === 'loading' || s.state === 'checking' || app.busy;
  const origin = loadOrigin();
  const src = host()?.source;
  const where = s.state === 'ready'
    ? origin.from === 'file' ? `Loaded from ${origin.fileName ?? 'a local file'} in ${s.seconds.toFixed(1)} s` : `In this browser · loaded in ${s.seconds.toFixed(1)} s`
    : stored > 0 ? `In this browser (${fmtBytes(stored)})` : 'Not in this browser yet';
  const removable = stored > 0 || (s.state === 'ready' && origin.from !== 'file');

  async function remove(): Promise<void> {
    setRemoving(true);
    try { await removeModel(); setStored(await storedBytes()); } finally { setRemoving(false); setConfirming(false); }
  }

  return (
    <div className="text-sm">
      <div className="space-y-1.5 p-4 pb-3">
        <div className="font-medium">{MODEL_FACTS.name}</div>
        <p className="text-xs leading-relaxed text-muted-foreground">{MODEL_FACTS.result}</p>
      </div>
      <div className="border-t px-4 py-2">
        {current !== null && (
          <div className={ROW}>
            <span className="text-muted-foreground">Version</span>
            <span className="text-right">
              v{current}
              {latest !== null && latest === current && <span className="text-muted-foreground"> · latest</span>}
              {latest !== null && latest > current && <span className="text-muted-foreground"> · v{latest} is on Hugging Face</span>}
            </span>
          </div>
        )}
        <div className={ROW}><span className="text-muted-foreground">Size</span><span className="tabular-nums">{fmtBytes(modelBytes())}</span></div>
        <div className={ROW}><span className="text-muted-foreground">Status</span><span className="text-right">{where}</span></div>
        {src && (
          <div className={ROW}>
            <span className="text-muted-foreground">Source</span>
            {src.page
              ? <a className="truncate underline-offset-4 hover:underline" href={src.page} target="_blank" rel="noopener">{src.page.replace(/^https:\/\/huggingface\.co\//, '')}</a>
              : <span className="truncate">{src.label}</span>}
          </div>
        )}
      </div>

      {latest !== null && current !== null && latest > current && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          A newer model (v{latest}) is on Hugging Face. This site switches to it once it is set up and tested for it.
        </p>
      )}
      {older && (
        <div className="flex items-center gap-2 border-t px-4 py-2.5 text-xs">
          <span className="mr-auto text-muted-foreground">
            {older.version !== null ? `v${older.version}` : 'An older version'} is also saved here ({fmtBytes(older.bytes)}){s.state === 'ready' ? '' : `; it is removed once v${current ?? ''} is ready`}.
          </span>
          <Button size="xs" variant="ghost" disabled={busy || removingOlder} className="text-muted-foreground"
            onClick={() => { setRemovingOlder(true); void removeOlder().finally(() => setRemovingOlder(false)); }}>
            <Trash2 />Remove
          </Button>
        </div>
      )}

      {s.state === 'loading' && (() => {
        const v = progressView(s);
        return (
          <div className="space-y-1.5 border-t px-4 py-3">
            <ProgressBar percent={v.percent} label={v.title} />
            <div className="text-xs text-muted-foreground tabular-nums">{v.line}{v.percent !== null && ` · ${v.percent.toFixed(0)}%`}</div>
          </div>
        );
      })()}
      {s.state === 'unsupported' && <p className="border-t px-4 py-3 text-xs text-muted-foreground">{s.reason}</p>}
      {s.state === 'error' && <p role="alert" className="border-t px-4 py-3 text-xs break-words text-destructive">{s.message}</p>}

      {s.state !== 'unsupported' && (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
          {(s.state === 'absent' || s.state === 'error') && (
            <Button size="sm" onClick={download}>
              {s.state === 'error' ? <><RotateCcw />Try again</> : <><Download />{older && current !== null ? `Update to v${current}` : 'Download'}</>}
            </Button>
          )}
          <LocalFile>
            {(open) => <Button size="sm" variant="ghost" disabled={busy} onClick={open}><Upload />Use a local file</Button>}
          </LocalFile>
          {removable && !confirming && (
            <Button size="sm" variant="ghost" disabled={busy} className="text-muted-foreground" onClick={() => setConfirming(true)}>
              <Trash2 />Remove from this browser
            </Button>
          )}
        </div>
      )}
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/50 px-4 py-3">
          <span className="mr-auto text-xs">Remove {stored ? fmtBytes(stored) : 'the weights'} from this browser?</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button size="sm" variant="destructive" disabled={removing} onClick={() => void remove()}>Remove</Button>
        </div>
      )}

      <Collapsible className="border-t">
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:bg-muted">
          <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />Model size: 4-bit, 3-bit, 2-bit or ternary
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ModelPicker className="px-4 pb-3" />
        </CollapsibleContent>
      </Collapsible>

      <Collapsible
        className="border-t"
        onOpenChange={(open) => {
          if (!open || checks) return;
          void deviceChecks().then(setChecks).catch((e: unknown) => setChecksError(e instanceof Error ? e.message : String(e)));
        }}
      >
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:bg-muted">
          <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />This device
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="space-y-2 px-4 pb-3 text-xs">
            {!checks && !checksError && <li className="text-muted-foreground">Checking…</li>}
            {checksError && <li className="text-muted-foreground">{checksError}</li>}
            {checks?.map((c) => (
              <li key={c.name} className="flex gap-2">
                <span aria-hidden="true" className={cn('mt-1 size-1.5 shrink-0 rounded-full', c.ok === true ? 'bg-success' : c.ok === false ? 'bg-destructive' : 'bg-muted-foreground/50')} />
                <span><span className="font-medium">{c.name}</span> <span className="text-muted-foreground">{c.detail}</span></span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
