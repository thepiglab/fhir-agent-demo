// The empty conversation's card while the model is not ready: download it (with progress), load
// it from this browser, use a local file, or see why it cannot run. CONVERSATION renders it.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Download, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { download, fmtSize, loadOrigin, lowMemory, modelBytes, preferLocal, progressView, versionInfo } from '../../app/model-gate.ts';
import { useModel } from './useModel.ts';

import { LocalFile, ProgressBar } from './parts.tsx';

const linkClass = 'text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm';

export function ModelCard({ className }: { className?: string }) {
  const s = useModel();
  const root = useRef<HTMLElement>(null);
  // When the model becomes ready while focus is in the card, hand focus to the composer.
  useEffect(() => {
    if (s.state === 'ready' && root.current?.contains(document.activeElement)) {
      document.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    }
  }, [s.state]);
  if (s.state === 'ready') return null;

  const size = fmtSize(modelBytes());
  let title = '';
  let body: string | null = null;
  let content: ReactNode = null;

  switch (s.state) {
    case 'checking':
      title = 'Getting the model ready';
      body = 'Checking whether it is already in this browser…';
      content = <ProgressBar percent={null} label="Checking" />;
      break;
    case 'absent': {
      // An older version is saved here: offer the swap (the old one is deleted once the new one is ready).
      const { current, older } = versionInfo();
      const name = (v: number | null) => (v === null ? 'the new model' : `v${v}`);
      const olderName = older?.version != null ? `v${older.version}` : 'an older version';
      title = older ? `Update the model to ${name(current)}` : 'Download the model to start';
      body = older
        ? `This browser has ${olderName} of the model saved. ${name(current)} is a ${size} download; ${olderName} (${fmtSize(older.bytes)}) is removed once ${name(current)} is ready.`
        : `${size}, once. It stays in this browser; every question runs here, privately.`;
      const action = older ? `Update to ${name(current)}` : 'Download';
      if (lowMemory() !== null) body += ` This device reports ${lowMemory()} GB of memory; the model needs about 3 GB free, so it may not load.`;
      content = (
        <LocalFile>
          {(open) => preferLocal ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button onClick={open}><Upload />Choose a .gguf file</Button>
              <button type="button" className={linkClass} onClick={download}>{older ? `${action} instead` : 'Download it instead'}</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button onClick={download}>{older ? <RefreshCw /> : <Download />}{action}</Button>
              <button type="button" className={linkClass} onClick={open}>Use a local file</button>
            </div>
          )}
        </LocalFile>
      );
      break;
    }
    case 'loading': {
      const v = progressView(s);
      const from = loadOrigin().from;
      title = v.title;
      body = from === 'network' ? 'This happens once; next time it loads in seconds.'
        : from === 'file' ? 'Read in place from your computer; nothing is uploaded.' : null;
      content = (
        <div className="space-y-2">
          <ProgressBar percent={v.percent} label={v.title} />
          <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums" aria-hidden="true">
            <span>{v.line}</span>
            {v.percent !== null && <span>{v.percent.toFixed(0)}%</span>}
          </div>
        </div>
      );
      break;
    }
    case 'unsupported':
      title = 'This browser can’t run the model';
      body = `${s.reason} You can still browse the charts.`;
      break;
    case 'error':
      title = 'The model didn’t load';
      body = 'Nothing was sent anywhere. Try again, or use a local copy of the weights.';
      content = (
        <div className="space-y-4">
          <p role="alert" className="text-sm break-words text-destructive">{s.message}</p>
          <LocalFile>
            {(open) => (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button onClick={download}><RotateCcw />Try again</Button>
                <button type="button" className={linkClass} onClick={open}>Use a local file</button>
              </div>
            )}
          </LocalFile>
        </div>
      );
      break;
  }

  return (
    <section
      ref={root} aria-labelledby="model-card-title" aria-live="polite"
      className={cn('w-full max-w-md rounded-2xl border bg-card p-6 text-card-foreground', className)}
    >
      <h2 id="model-card-title" className="text-base font-medium">{title}</h2>
      {body && <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>}
      {content && <div className="mt-5">{content}</div>}
    </section>
  );
}
