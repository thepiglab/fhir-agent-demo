// The working mark (assistant-ui Loader, "dots" variant): a 3×3 grid of 3px dots in which a lit
// diagonal band moves on a 120 ms tick. Reduced motion: a still grid.
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const CELLS = Array.from({ length: 9 }, (_, i) => ({ row: Math.floor(i / 3), col: i % 3 }));
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function DotMatrix({ className }: { className?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (still()) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, []);
  // Diagonals 0..4 sweep across, with a short pause (two empty ticks) between passes.
  const band = tick % 7;
  return (
    <span aria-hidden="true" className={cn('grid size-3.5 shrink-0 grid-cols-3 place-items-center', className)}>
      {CELLS.map(({ row, col }, i) => {
        const d = row + col;
        const lit = d === band, trail = d === band - 1;
        return (
          <span key={i} className={cn('size-[3px] rounded-full bg-foreground transition-opacity duration-100',
            lit ? 'opacity-90' : trail ? 'opacity-45' : 'opacity-15')} />
        );
      })}
    </span>
  );
}
