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
import { cn } from '@/lib/utils';
import { app, setDev } from '../../app/state.ts';
import { initModel } from '../../app/model-gate.ts';
import '../benchmark/logic.ts';
import { chooseCohort } from '../../chart/data.ts';
import type { Cohort } from '../../chart/data.ts';
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
  if (!cohort) return <span className="ml-1 h-4 w-28 animate-pulse rounded bg-muted" aria-hidden="true" />;
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
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="More">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
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
              <DropdownMenuRadioItem value="X16">X16{MODEL_HARNESS === 'X16' ? ' · model default' : ''}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="X16v2">X16v2{MODEL_HARNESS === 'X16v2' ? ' · model default' : ''}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {dev ? (
          <DropdownMenuCheckboxItem
            checked={replyOn}
            onCheckedChange={(on) => { setReplyToggle(on === true); setReplyOn(on === true); }}
            title="LFM3 writes a few sentences after its answer, shown only if its checks pass (including the write log). Its replies were wrong on 20-33% of episodes in the agent-scope pilot, so it is off by default."
          >
            Written summary (experimental)
          </DropdownMenuCheckboxItem>
        ) : null}
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
        <span aria-hidden="true" className="text-[19px] leading-none">🔥</span>
        <span className="text-[15px] font-medium max-[640px]:hidden">EHR agent</span>
      </a>
      <DatasetPicker />
      <div className="flex-1" />
      <ModelStatusButton />
      <MoreMenu />
    </header>
  );
}
