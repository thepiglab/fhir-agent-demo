// Show or hide the chart panel: a quiet icon button with a tooltip.
import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { setPanel } from '../../app/state.ts';
import { useApp } from '../store.ts';

export function ChartToggle({ className }: { className?: string }) {
  const { panelOpen } = useApp(['panel']);
  const label = panelOpen ? 'Hide chart' : 'Show chart';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          id="chart-toggle" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={panelOpen} aria-controls="chart-panel"
          onClick={() => setPanel(!panelOpen)}
          className={cn('text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground', className)}
        >
          <PanelRight />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
