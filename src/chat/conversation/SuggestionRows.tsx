// The empty state's suggested questions: a shuffled pool for this patient and voice, shown as two
// slowly drifting rows (opposite directions): scroll or drag one to send it along; it eases back to
// its drift. Under the pointer or keyboard focus a row eases to a stop.
// The pool is this patient's role-specific question bank (questionBank.ts): no question is shared
// between physician, nurse and front desk.
// With reduced motion the rows do not drift, but still scroll and drag.
import { useEffect, useMemo, useRef, useState } from 'react';
import { app } from '../../app/state.ts';
import { questionBank } from './questionBank.ts';
import type { Voice } from './questionBank.ts';

export type { Voice };

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Drift speed of the suggestion rows: slow enough to read a pill as it passes. */
const PX_PER_SECOND = 12;

/** This patient's questions for one role (see questionBank.ts), shuffled once per patient and role. */
export function useSuggestionPool(patient: string | undefined, voice: Voice): string[] | null {
  const [state, setState] = useState<{ key: string; list: string[] } | null>(null);
  const key = `${patient} ${voice}`;
  useEffect(() => {
    if (!patient) return;
    let live = true;
    void questionBank(patient, voice).catch(() => [] as string[]).then((list) => {
      if (!list.length) {
        const index = (['physician', 'nurse', 'clerical'] as const).indexOf(voice);
        list = Object.values(app.config?.requests ?? {}).map((l) => l[index] ?? l[0]).filter((q): q is string => !!q);
      }
      if (live) setState({ key, list: shuffled(list) });
    });
    return () => { live = false; };
  }, [patient, voice, key]);
  return state?.key === key ? state.list : null;
}

function Pill({ q, onChoose, hidden }: { q: string; onChoose: (q: string) => void; hidden?: boolean }) {
  return (
    <button type="button" onClick={() => onChoose(q)} tabIndex={hidden ? -1 : undefined} role={hidden ? undefined : 'listitem'}
      className="shrink-0 whitespace-nowrap rounded-full border border-border/70 bg-background/60 px-3.5 py-1.5 text-[13px] text-muted-foreground outline-none transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
      {q}
    </button>
  );
}

/** How fast a row's speed returns to its drift after a scroll or drag (per second). */
const SETTLE = 1.6;
/** Wheel pixels to px/s of speed: a flick sends the row along, then it slows back to its drift. */
const WHEEL_GAIN = 9;
/** Pointer movement past this many pixels is a drag, not a click on a pill. */
const DRAG_SLOP = 5;

/**
 * One drifting row: the pills twice in a track moved by script, so the loop is seamless. The row
 * drifts at PX_PER_SECOND (left, or right when reversed). A wheel or trackpad swipe over it, or a
 * drag, adds speed; the speed then eases back to the drift, so the row slows and resumes its own
 * direction. Under the pointer the drift eases to a stop so a pill can be read and clicked.
 */
function Row({ items, onChoose, reverse }: { items: string[]; onChoose: (q: string) => void; reverse?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current, tr = track.current;
    if (!el || !tr) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const drift = still ? 0 : (reverse ? 1 : -1) * PX_PER_SECOND;
    let x = 0, v = drift, hover = false, last = performance.now(), frame = 0;
    let drag: { id: number; startX: number; lastX: number; lastT: number; moved: boolean } | null = null;
    const period = () => (tr.scrollWidth + 8) / 2;  // one set of pills plus the gap between the sets
    const wrap = () => { const p = period(); if (p > 0) { x %= p; if (x > 0) x -= p; } };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!drag) {
        const target = hover ? 0 : drift;
        v += (target - v) * (1 - Math.exp(-SETTLE * dt));
        x += v * dt;
      }
      wrap();
      tr.style.transform = `translate3d(${x}px,0,0)`;
      frame = requestAnimationFrame(tick);
    };
    const onWheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      v -= d * WHEEL_GAIN * (e.deltaMode === 1 ? 16 : 1) / 10;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, startX: e.clientX, lastX: e.clientX, lastT: performance.now(), moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.startX) > DRAG_SLOP) { drag.moved = true; el.setPointerCapture(e.pointerId); }
      if (!drag.moved) return;
      const now = performance.now(), dx = e.clientX - drag.lastX, dt = Math.max(1, now - drag.lastT) / 1000;
      x += dx;
      v = dx / dt;
      drag.lastX = e.clientX; drag.lastT = now;
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      // A drag ends with no click on the pill under the pointer.
      if (moved) el.addEventListener('click', (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
    };
    const enter = () => { hover = true; };
    const leave = () => { hover = false; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', enter);
    el.addEventListener('focusout', leave);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', enter);
      el.removeEventListener('focusout', leave);
    };
  }, [items, reverse]);
  return (
    <div ref={box} className="marquee-mask w-full cursor-grab touch-pan-y overflow-hidden select-none active:cursor-grabbing">
      <div ref={track} className="flex w-max gap-2 py-0.5 will-change-transform">
        {items.map((q) => <Pill key={q} q={q} onChoose={onChoose} />)}
        <div aria-hidden="true" className="flex gap-2">
          {items.map((q) => <Pill key={q} q={q} onChoose={onChoose} hidden />)}
        </div>
      </div>
    </div>
  );
}

/** The suggestions: two drifting rows when there are enough, else one still, centred row. */
export function SuggestionRows({ list, onChoose }: { list: string[]; onChoose: (q: string) => void }) {
  const [top, bottom] = useMemo(() => {
    const half = Math.ceil(list.length / 2);
    return [list.slice(0, half), list.slice(half)];
  }, [list]);
  if (list.length < 4) {
    return (
      <div className="flex flex-wrap justify-center gap-2" role="list" aria-label="Suggested questions">
        {list.map((q) => <Pill key={q} q={q} onChoose={onChoose} />)}
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2" role="list" aria-label="Suggested questions">
      <Row items={top} onChoose={onChoose} />
      <Row items={bottom} onChoose={onChoose} reverse />
    </div>
  );
}
