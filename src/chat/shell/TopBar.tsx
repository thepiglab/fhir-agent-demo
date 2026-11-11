// The top bar: brand, the dataset picker, the model's status, and one overflow menu (theme,
// developer view, About). Importing it also starts the model status mirror and the benchmark
// picking logic, which run for the whole page.
import { MODEL_HARNESS, chosenHarness, longCharts, setChosenHarness, setLongCharts } from '../../model/config.ts';
import { replyToggle, setReplyToggle } from '../conversation/replySetting.ts';
import { useEffect, useState } from 'react';
import { Check, ChevronDown, Ellipsis } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { app, setDev } from '../../app/state.ts';
import { initModel } from '../../app/model-gate.ts';
import '../benchmark/logic.ts';
import { chooseCohort } from '../../chart/data.ts';
import type { Cohort } from '../../chart/data.ts';
import { ShortcutsButton } from './Shortcuts.tsx';
import { cohortLine, cohortName, cohortShort, isTechnical } from './cohorts.ts';
import { useApp } from '../store.ts';
import { getTheme, onTheme, setTheme } from '../theme.ts';
import type { Theme } from '../theme.ts';
import { ModelStatusButton } from '../model/ModelStatus.tsx';

initModel();

// ---------- datasets ----------

function pickCohort(c: Cohort): void {
  if (c.id === app.cohort?.id) return;
  chooseCohort(c.id);
  // The patient in the hash belongs to the old dataset: reload without it.
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

function CohortItem({ c, active }: { c: Cohort; active: boolean }) {
  return (
    <DropdownMenuItem onSelect={() => pickCohort(c)} className="items-start gap-3 px-2.5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{cohortName(c)}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{cohortLine(c)}</span>
      </span>
      <Check className={cn('mt-0.5 size-4', active ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
    </DropdownMenuItem>
  );
}

function DatasetPicker() {
  const { cohort, cohorts, dev } = useApp(['ready', 'dev']);
  // One dataset to show (the held-out natural prompts): nothing to choose, so no picker.
  const choices = cohorts.filter((c) => dev || !isTechnical(c));
  if (!cohort || choices.length <= 1) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2 font-normal text-muted-foreground hover:text-foreground" aria-label={`Dataset: ${cohortName(cohort)}. Change dataset`}>
          <span className="max-[640px]:hidden">{cohortName(cohort)}</span>
          <span className="min-[641px]:hidden">{cohortShort(cohort)}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-[min(22rem,calc(100vw-1.5rem))] p-1.5">
        <DropdownMenuLabel className="px-2.5 pt-1.5 pb-1 text-xs font-normal text-muted-foreground">Dataset</DropdownMenuLabel>
        {cohorts.filter((c) => !isTechnical(c)).map((c) => <CohortItem key={c.id} c={c} active={c.id === cohort.id} />)}
        {dev && cohorts.some(isTechnical) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2.5 pt-1.5 pb-1 text-xs font-normal text-muted-foreground">Developer view only</DropdownMenuLabel>
            {cohorts.filter(isTechnical).map((c) => <CohortItem key={c.id} c={c} active={c.id === cohort.id} />)}
          </>
        ) : null}
        <p className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">Switching reloads the page.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------- overflow menu ----------

function MoreMenu() {
  const { dev } = useApp(['dev']);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [replyOn, setReplyOn] = useState(replyToggle);
  useEffect(() => onTheme(setThemeState), []);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-8 rounded-full text-muted-foreground hover:text-foreground" aria-label="Settings">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Settings</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={8} className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="auto">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={dev} onCheckedChange={(on) => setDev(on === true)}>
          Developer view
        </DropdownMenuCheckboxItem>
        {dev ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Harness</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={chosenHarness() ?? MODEL_HARNESS} onValueChange={(v) => { setChosenHarness(v === MODEL_HARNESS ? null : v as typeof MODEL_HARNESS); location.reload(); }}>
              <DropdownMenuRadioItem value="L">L (locked){MODEL_HARNESS === 'L' ? ' · model default' : ''}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="Lc">Lc (compact search){MODEL_HARNESS === 'Lc' ? ' · model default' : ''}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="X16">X16{MODEL_HARNESS === 'X16' ? ' · model default' : ''}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="X16v2">X16v2{MODEL_HARNESS === 'X16v2' ? ' · model default' : ''}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuCheckboxItem
          checked={replyOn}
          onCheckedChange={(on) => { setReplyToggle(on === true); setReplyOn(on === true); }}
          title="A few sentences after the answer, shown only when its checks against the cited records pass."
        >
          Written summary
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={longCharts()}
          onCheckedChange={(on) => { setLongCharts(on === true); location.reload(); }}
          title="A 24,576-token context instead of 16,384, for questions that outgrow it. Uses more memory; the model reloads."
        >
          Long charts
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><a href="./">About</a></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------- the bar ----------

export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-background px-3 sm:px-4">
      <a href="./" className="mr-1 flex items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="EHR agent: about this demo">
        <span className="text-[15px] font-medium">🔥<span className="max-[640px]:hidden"> EHR agent</span></span>
      </a>
      <DatasetPicker />
      <div className="flex-1" />
      {/* One group: the model's status, then settings, then help. */}
      <div className="flex items-center gap-0.5 rounded-full border border-border/60 p-0.5">
        <ModelStatusButton />
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
        <MoreMenu />
        <ShortcutsButton />
      </div>
    </header>
  );
}
