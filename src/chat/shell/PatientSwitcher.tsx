// The patient at the top of the conversation (name + chevron, a muted meta line) and the switcher
// it opens (click): each patient by problem list, chart size and question topics; search covers those
// as well as name and MRN; Enter selects.
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { app, setPatient } from '../../app/state.ts';
import { cap, plural } from '../../app/dom.ts';
import type { ChartPatient } from '../../types.ts';
import { bench, loadIndex, questionCounts } from '../benchmark/logic.ts';
import { useBench } from '../benchmark/useBench.ts';
import { useApp } from '../store.ts';


/** "31 y · Female · MRN SYN-3ef1740bc8". */
export const patientMeta = (p: ChartPatient): string =>
  [p.age !== null && p.age !== undefined ? `${p.age} y` : null, p.gender ? cap(p.gender) : null, p.mrn ? `MRN ${p.mrn}` : null]
    .filter(Boolean).join(' · ');

/** What tells synthetic patients apart: their problem list, else their medications. */
const short = (label: string): string => label.replace(/\s*\([^)]*\)/g, '').trim();
export const patientHeadline = (p: ChartPatient): string =>
  p.problems?.length ? p.problems.slice(0, 3).map(short).join(', ') + (p.problems.length > 3 ? ` +${p.problems.length - 3}` : '')
    : p.medications?.length ? `On ${p.medications.join(', ')}` : 'No problems on file';

type Band = 'child' | 'adult' | 'older';
const BANDS: [Band, string][] = [['child', 'Under 18'], ['adult', '18–64'], ['older', '65+']];
const bandOf = (p: ChartPatient): Band | null =>
  typeof p.age !== 'number' ? null : p.age < 18 ? 'child' : p.age < 65 ? 'adult' : 'older';

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        on ? 'border-foreground/30 bg-foreground/10 text-foreground' : 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground')}>
      {children}
    </button>
  );
}

/** "31 y F · 13 visits · 22 notes". */
const chartLine = (p: ChartPatient): string => {
  const c = p.counts ?? {};
  return [
    [p.age !== null && p.age !== undefined ? `${p.age} y` : null, p.gender ? p.gender[0]!.toUpperCase() : null].filter(Boolean).join(' '),
    c.Encounter ? plural(c.Encounter, 'visit') : null,
    c.DocumentReference ? plural(c.DocumentReference, 'note') : null,
    c.Observation ? plural(c.Observation, 'result') : null,
  ].filter(Boolean).join(' · ');
};

export function PatientSwitcherButton({ className }: { className?: string }) {
  const { patient } = useApp(['patient', 'ready']);
  const [open, setOpen] = useState(false);

  if (!patient) {
    return (
      <div className={cn('space-y-1.5 py-0.5', className)} aria-hidden="true">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-3 w-56 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Patient: ${patient.name}. Switch patient`}
        title="Switch patient"
        className={cn('group -mx-2 flex min-w-0 flex-col items-start rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50', className)}
      >
        <span className="flex max-w-full items-center gap-1">
          <span className="truncate text-[15px] font-medium">{patient.name}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-px" aria-hidden="true" />
        </span>
        <span className="max-w-full truncate text-xs text-muted-foreground">{patientMeta(patient)}</span>
      </button>
      <PatientSwitcher open={open} onOpenChange={setOpen} />
    </>
  );
}

function PatientSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { patients, patient } = useApp(['patient', 'ready']);
  useBench();
  const [search, setSearch] = useState('');
  const [band, setBand] = useState<Band | null>(null);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  useEffect(() => { if (open) { setSearch(''); setSelected(app.patient?.id ?? ''); void loadIndex().catch(() => {}); } }, [open]);

  const counts = questionCounts();
  // Each patient's benchmark question specialties, most common first.
  const specialties = useMemo(() => {
    const by = new Map<string, Map<string, number>>();
    for (const r of bench.index ?? []) {
      if (!r.specialty) continue;
      const m = by.get(r.patient) ?? new Map<string, number>();
      m.set(r.specialty, (m.get(r.specialty) ?? 0) + 1);
      by.set(r.patient, m);
    }
    return new Map([...by].map(([id, m]) => [id, [...m].sort((a, b) => b[1] - a[1]).map(([s]) => s)]));
  }, [bench.index]);

  const haystack = (p: ChartPatient): string =>
    [p.name, p.mrn ?? '', p.id, ...(p.problems ?? []), ...(p.medications ?? []), ...(specialties.get(p.id) ?? [])].join(' ').toLowerCase();
  const matchesSearch = (p: ChartPatient, t: string): boolean =>
    (!t || t.split(/\s+/).every((w) => haystack(p).includes(w)))
    && (!band || bandOf(p) === band)
    && (!specialty || !!specialties.get(p.id)?.includes(specialty));
  // The specialties that most patients have questions in, for the filter chips.
  const topSpecialties = useMemo(() => {
    const n = new Map<string, number>();
    for (const list of specialties.values()) for (const sp of list) n.set(sp, (n.get(sp) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([sp]) => sp);
  }, [specialties]);
  const q = search.trim().toLowerCase();
  const filtered = !!q || !!band || !!specialty;
  const shown = filtered ? patients.filter((p) => matchesSearch(p, q)) : patients;
  const onSearch = (text: string) => {
    setSearch(text);
    setSelected(patients.find((p) => matchesSearch(p, text.trim().toLowerCase()))?.id ?? '');
  };
  useEffect(() => { if (open) { setBand(null); setSpecialty(null); } }, [open]);
  useEffect(() => { setSelected(shown[0]?.id ?? ''); }, [band, specialty]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Switch patient</DialogTitle>
        <DialogDescription className="sr-only">Search by condition, medication, specialty, name or MRN. Enter opens the patient.</DialogDescription>
        <Command shouldFilter={false} loop value={selected} onValueChange={setSelected} className="[&_[cmdk-input-wrapper]]:h-12">
          <CommandInput value={search} onValueChange={onSearch} placeholder="Search by condition, medication, specialty or MRN" className="h-12 text-[15px]" />
          <div className="flex gap-1.5 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none]" role="group" aria-label="Filter patients">
            {BANDS.map(([b, label]) => <Chip key={b} on={band === b} onClick={() => setBand(band === b ? null : b)}>{label}</Chip>)}
            <span aria-hidden="true" className="mx-0.5 w-px shrink-0 bg-border" />
            {topSpecialties.map((sp) => <Chip key={sp} on={specialty === sp} onClick={() => setSpecialty(specialty === sp ? null : sp)}>{sp}</Chip>)}
          </div>
          <CommandList className="max-h-[min(420px,60vh)]">
            <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">No patient matches “{search.trim()}”</CommandEmpty>
            <CommandGroup heading={filtered ? `${shown.length} of ${plural(patients.length, 'patient')}` : plural(patients.length, 'patient')}>
              {shown.map((p) => {
                const n = counts?.get(p.id);
                const current = p.id === patient?.id;
                return (
                  <CommandItem
                    key={p.id} value={p.id}
                    onSelect={() => { onOpenChange(false); setPatient(p); }}
                    className="items-start gap-3 px-2.5 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={cn('truncate font-medium', !p.problems?.length && 'text-muted-foreground')}>{patientHeadline(p)}</span>
                        {current && <Check className="size-3.5 shrink-0" aria-label="Current patient" />}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{chartLine(p)}{p.mrn ? ` · ${p.mrn}` : ''}</span>
                    </span>
                    <span className="flex w-36 shrink-0 flex-col items-end gap-0.5 text-right text-xs text-muted-foreground">
                      {n !== undefined && <span className="tabular-nums">{plural(n, 'question')}</span>}
                      {!!specialties.get(p.id)?.length && <span className="block max-w-full truncate">{specialties.get(p.id)!.slice(0, 2).join(' · ')}</span>}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          <div className="flex gap-4 border-t px-3 py-2 text-xs text-muted-foreground max-[640px]:hidden">
            <span>↑↓ move</span><span>Enter open</span><span>Esc close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
