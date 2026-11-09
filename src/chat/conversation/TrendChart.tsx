// A trend as a Chart card (assistant-ui Chart look): the test, the latest value as the headline,
// the change since the previous value, a small hand-drawn SVG line whose points land one at a
// time, and the values in a compact table. Values come from the chart's records when the run
// cited them (Trend.fromRecords), otherwise from the answer.
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmtDate } from '../../app/dom.ts';
import { statusWord } from './answer.ts';
import type { Ctx, Trend } from './answer.ts';
import { openRecord } from './hooks.ts';
import { Cited, withUnit } from './values.tsx';

const H = 140, L = 44, R = 18, T = 14, B = 26;
const decimals = (n: number): number => (String(n).split('.')[1] ?? '').length;
const time = (d: string): number => Date.parse(d.length === 10 ? d + 'T00:00:00Z' : d);

function niceTicks(lo: number, hi: number, places: number): number[] {
  const mid = (lo + hi) / 2;
  const round = (n: number) => Number(n.toFixed(Math.min(places + 1, 3)));
  return [round(lo), round(mid), round(hi)];
}

export function TrendChart({ trend, ctx }: { trend: Trend; ctx: Ctx }) {
  // Drawn at the box's real width, so labels keep their size on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(520);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setW(Math.max(240, Math.round(el.clientWidth)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fill = `trend-fill-${useId().replace(/:/g, '')}`;
  const pts = trend.points;
  const last = pts.at(-1)!, prev = pts.at(-2)!;
  const places = Math.max(...pts.map((p) => decimals(p.value)));
  const change = Number((last.value - prev.value).toFixed(places));
  const outside = (trend.low !== null && last.value < trend.low) || (trend.high !== null && last.value > trend.high);
  const known = trend.low !== null || trend.high !== null;
  const tone = !known ? 'text-foreground' : outside ? 'text-warning' : 'text-success';
  const word = change > 0 ? 'Up' : change < 0 ? 'Down' : 'No change';

  // Scales: time on x when the dates differ, else even spacing; y padded around the values.
  const times = pts.map((p) => time(p.date));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const byTime = t1 > t0 && times.every((t) => Number.isFinite(t));
  const x = (i: number) => L + (byTime ? (times[i]! - t0) / (t1 - t0) : pts.length > 1 ? i / (pts.length - 1) : 0.5) * (W - L - R);
  const values = pts.map((p) => p.value);
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo) * 0.25 || Math.abs(hi) * 0.1 || 1;
  lo -= pad; hi += pad;
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  const ticks = niceTicks(lo + pad * 0.5, hi - pad * 0.5, places);
  const rows = [...pts].reverse();
  const anyStatus = pts.some((p) => statusWord(p.status));

  return (
    <figure className="rounded-2xl border bg-card p-4 sm:p-5" aria-label={`${trend.name} trend`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{trend.name}</p>
          <p className="mt-1 font-semibold text-3xl tabular-nums tracking-tight">
            {last.path ? <Cited path={last.path} ctx={ctx}>{withUnit(last.value, trend.unit)}</Cited> : withUnit(last.value, trend.unit)}
          </p>
          <p className="mt-1 text-muted-foreground text-sm">{[fmtDate(last.date), statusWord(last.status)].filter(Boolean).join(' · ')}</p>
        </div>
        <p className="text-sm">
          <span className={cn('font-medium tabular-nums', tone)}>{change === 0 ? word : `${word} ${withUnit(Math.abs(change).toFixed(places), trend.unit)}`}</span>
          <span className="text-muted-foreground"> since {fmtDate(prev.date)}</span>
        </p>
      </div>

      <div ref={box} className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full overflow-visible" role="img"
        aria-label={`${trend.name}: ${pts.map((p) => `${withUnit(p.value, trend.unit)} on ${fmtDate(p.date)}`).join(', ')}`}>
        <defs>
          <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={L - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{v}</text>
          </g>
        ))}
        {trend.low !== null && trend.high !== null && trend.low > lo && trend.high < hi ? (
          <rect x={L} width={W - L - R} y={y(trend.high)} height={Math.max(0, y(trend.low) - y(trend.high))} fill="var(--success)" opacity="0.06" />
        ) : null}
        <path d={area} fill={`url(#${fill})`} className="animate-in fade-in-0 duration-700" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="animate-in fade-in-0 duration-500" />
        {pts.map((p, i) => {
          const isLast = i === pts.length - 1;
          return (
            <g key={`${p.ref ?? i}-${p.date}`} className="animate-in fade-in-0 zoom-in-50 duration-300"
              style={{ animationDelay: `${120 + i * 110}ms`, animationFillMode: 'both', transformBox: 'fill-box', transformOrigin: 'center' }}>
              {isLast ? <circle cx={x(i)} cy={y(p.value)} r="8" fill="var(--brand)" opacity="0.15" /> : null}
              <circle cx={x(i)} cy={y(p.value)} r={isLast ? 4.5 : 3} fill={isLast ? 'var(--brand)' : 'var(--card)'} stroke="var(--brand)" strokeWidth="2" />
            </g>
          );
        })}
        {pts.map((p, i) => (i === 0 || i === pts.length - 1 || pts.length <= 4 ? (
          <text key={`x-${i}`} x={x(i)} y={H - 6} textAnchor={i === 0 && byTime ? 'start' : i === pts.length - 1 && byTime ? 'end' : 'middle'}
            className="fill-muted-foreground text-[11px]">{fmtDate(p.date)}</text>
        ) : null))}
      </svg>
      </div>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-xs">
            <th className="py-1.5 text-left font-normal">Date</th>
            <th className="py-1.5 text-right font-normal">{trend.name}</th>
            {anyStatus ? <th className="hidden py-1.5 pl-4 text-right font-normal sm:table-cell">Status</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y border-t">
          {rows.map((p, i) => (
            <tr key={`${p.ref ?? i}-${p.date}`} className={cn(p.ref && 'cursor-pointer hover:bg-muted/50')} onClick={() => p.ref && openRecord(p.ref)}>
              <td className="py-2 text-muted-foreground">{fmtDate(p.date)}</td>
              <td className={cn('py-2 text-right tabular-nums', i === 0 && 'font-medium')}>
                {p.path ? <Cited path={p.path} ctx={ctx}>{withUnit(p.value, trend.unit)}</Cited> : withUnit(p.value, trend.unit)}
              </td>
              {anyStatus ? <td className="hidden py-2 pl-4 text-right text-muted-foreground sm:table-cell">{statusWord(p.status) || 'final'}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!trend.fromRecords ? <figcaption className="mt-2 text-muted-foreground text-xs">Values as the answer states them.</figcaption> : null}
    </figure>
  );
}
