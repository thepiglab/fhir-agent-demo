// What the model pickers show for each option (catalog.ts), as plain text: the Chart assistant's picker
// (React, src/chat/model/ModelPicker.tsx) and the landing page's (DOM, src/ui/model-page.ts) both render
// from this, so the wording, badges and hover text are written once.
import type { ModelOption } from './catalog.ts';

/** 1.1 GB, 755 MB. */
export const fmtSize = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB');

export interface OptionBadge { label: string; kind: 'recommended' | 'experimental'; title?: string }

export interface OptionView {
  /** "4-bit". */
  title: string;
  /** "Q4_K_M". */
  quant: string;
  /** "1.1 GB". */
  download: string;
  /** "about 1.7 GB of GPU memory". */
  memory: string;
  /** "1.7 GB GPU memory", for compact rows. */
  memoryShort: string;
  /** How the memory was measured (hover). */
  memoryHow: string;
  /** "standard runtime" or "low-bit runtime". */
  runtime: string;
  /** The quality line; ends in "*" when the score was measured on another file. */
  quality: string;
  /** Where the score was measured, when not on this file (hover and screen readers). */
  qualityNote: string | null;
  /** The quality line in brief, for compact rows: "59.3% on held-out questions*". */
  qualityShort: string;
  badges: OptionBadge[];
  /** One short tag for compact rows, or null: "Recommended" (experimental is said in the details only). */
  tag: { label: string; kind: OptionBadge['kind']; title?: string } | null;
  /** For a radio's accessible name: "2-bit (Q2_K), 755 MB download, recommended". */
  label: string;
}

export function optionView(o: ModelOption): OptionView {
  const badges: OptionBadge[] = [];
  if (o.recommended) badges.push({ label: 'Recommended', kind: 'recommended', title: o.recommended.reason });
  if (o.experimental) badges.push({ label: 'Experimental', kind: 'experimental' });
  const download = fmtSize(o.file.bytes);
  return {
    title: o.bits,
    quant: o.quant,
    download,
    memory: `about ${(o.memory.bytes / 1e9).toFixed(1)} GB of GPU memory`,
    memoryShort: `${(o.memory.bytes / 1e9).toFixed(1)} GB GPU memory`,
    memoryHow: `Measured: ${o.memory.how}`,
    runtime: o.runtime === 'vendored' ? 'standard runtime' : 'low-bit runtime',
    quality: o.scoreSource ? `${o.quality}*` : o.quality,
    qualityNote: o.scoreSource ?? null,
    qualityShort: `${(100 * o.score).toFixed(1)}% on held-out questions${o.scoreSource ? '*' : ''}`,
    badges,
    tag: o.recommended ? { label: 'Recommended', kind: 'recommended', title: o.recommended.reason }
      : null,
    label: `${o.bits} (${o.quant}), ${download} download${badges.map((b) => `, ${b.label.toLowerCase()}`).join('')}`,
  };
}

/** The weights are all in this browser (the vendored runtime stores tensor ranges, a little under the file). */
export const fullyStored = (o: ModelOption, stored: number): boolean => stored >= o.file.bytes * 0.98;
