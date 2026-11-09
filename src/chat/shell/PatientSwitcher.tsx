// The patient at the top of the conversation (name + chevron, a muted meta line) and the switcher
// it opens (click or ⌘K / Ctrl+K): search by name, MRN or id; Enter selects.
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { app, setPatient } from '../../app/state.ts';
import { cap, plural } from '../../app/dom.ts';
import type { ChartPatient } from '../../types.ts';
import { loadIndex, questionCounts } from '../benchmark/logic.ts';
import { useBench } from '../benchmark/useBench.ts';
import { useApp } from '../store.ts';


/** "31 y · Female · MRN SYN-3ef1740bc8". */
export const patientMeta = (p: ChartPatient): string =>
  [p.age !== null && p.age !== undefined ? `${p.age} y` : null, p.gender ? cap(p.gender) : null, p.mrn ? `MRN ${p.mrn}` : null]
    .filter(Boolean).join(' · ');

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
  const [selected, setSelected] = useState('');
  useEffect(() => { if (open) { setSearch(''); setSelected(app.patient?.id ?? ''); void loadIndex().catch(() => {}); } }, [open]);

  const counts = questionCounts();
  // Names that appear more than once get their MRN beside the name.
  const duplicate = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of patients) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  }, [patients]);

  const q = search.trim().toLowerCase();
  const shown = q ? patients.filter((p) => [p.name, p.mrn ?? '', p.id].some((s) => s.toLowerCase().includes(q))) : patients;
  const onSearch = (text: string) => {
    setSearch(text);
    const t = text.trim().toLowerCase();
    setSelected(patients.find((p) => !t || [p.name, p.mrn ?? '', p.id].some((s) => s.toLowerCase().includes(t)))?.id ?? '');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Switch patient</DialogTitle>
        <DialogDescription className="sr-only">Search by name, MRN or id. Enter opens the patient.</DialogDescription>
        <Command shouldFilter={false} loop value={selected} onValueChange={setSelected} className="[&_[cmdk-input-wrapper]]:h-12">
          <CommandInput value={search} onValueChange={onSearch} placeholder="Search by name, MRN or id" className="h-12 text-[15px]" />
          <CommandList className="max-h-[min(420px,60vh)]">
            <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">No patient matches “{search.trim()}”</CommandEmpty>
            <CommandGroup heading={q ? `${shown.length} of ${plural(patients.length, 'patient')}` : plural(patients.length, 'patient')}>
              {shown.map((p) => {
                const n = counts?.get(p.id);
                const current = p.id === patient?.id;
                return (
                  <CommandItem
                    key={p.id} value={p.id}
                    onSelect={() => { onOpenChange(false); setPatient(p); }}
                    className="gap-3 px-2.5 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{p.name}</span>
                        {duplicate.has(p.name) && p.mrn && <span className="shrink-0 text-xs text-muted-foreground">{p.mrn}</span>}
                        {current && <Check className="size-3.5 shrink-0" aria-label="Current patient" />}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{patientMeta(p)}</span>
                    </span>
                    {n !== undefined && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{plural(n, 'question')}</span>}
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
