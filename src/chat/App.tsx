// Layout. Each region is one part's component; see main.tsx for who owns what.
import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TopBar } from './shell/TopBar.tsx';
import { Conversation } from './conversation/Conversation.tsx';
import { ChartPanelHost } from './shell/ChartPanelHost.tsx';
import { GlobalDialogs } from './shell/Shortcuts.tsx';

export function App({ load }: { load: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }, [load]);
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="relative flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
            {error ? <p className="m-auto max-w-md text-sm text-destructive">Could not load the demo: {error}</p> : <Conversation />}
          </main>
          <ChartPanelHost />
        </div>
      </div>
      <GlobalDialogs />
    </TooltipProvider>
  );
}
