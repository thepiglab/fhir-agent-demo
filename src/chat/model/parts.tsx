// Small pieces the model views share: the progress bar and the local .gguf picker.
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { loadFile } from '../../app/model-gate.ts';

/** A thin progress bar; `percent` null is indeterminate (a soft pulse). */
export function ProgressBar({ percent, label, className }: { percent: number | null; label: string; className?: string }) {
  return (
    <div
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(percent)}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn('h-full rounded-full bg-brand transition-[width] duration-300 ease-out', percent === null && 'w-full animate-pulse opacity-40')}
        style={percent === null ? undefined : { width: `${percent.toFixed(1)}%` }}
      />
    </div>
  );
}

/** A hidden .gguf input; `children(open)` renders whatever opens it. */
export function LocalFile({ children }: { children: (open: () => void) => ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      {children(() => input.current?.click())}
      <input
        ref={input} type="file" accept=".gguf" hidden aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) loadFile(f); }}
      />
    </>
  );
}
