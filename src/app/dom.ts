// DOM and formatting helpers shared by the Chart assistant's parts (ported from the old
// chart.html script, typed).

export type Child = Node | string | number | null | undefined | false | Child[];
export type AttrValue = string | number | boolean | null | undefined | EventListener | ((event: never) => void);
export type Attrs = Record<string, AttrValue>;

/** Create an element: `class`, `html` (trusted markup only), `on<event>` listeners, attributes, then children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

/** Append children, skipping null/undefined/false (Element.append would print them). */
export function append(parent: Element | DocumentFragment, ...children: Child[]): void {
  for (const child of children.flat(Infinity as 1) as Child[]) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, ...child);
    else parent.append(child instanceof Node ? child : String(child));
  }
}

/** Replace a node's children. */
export function fill(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

/** The element with this id; throws if missing (a markup bug, not a runtime case). */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} is missing from the page`);
  return element as T;
}

/** An inline SVG from the icon set (trusted markup). */
export function svg(markup: string, cls = 'icon-svg'): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const node = t.content.firstElementChild as SVGElement;
  node.setAttribute('class', cls);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// ---------- formatting ----------
export const escapeHTML = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
export const fmtNum = (n: unknown): string => (typeof n === 'number' ? n.toLocaleString() : String(n ?? ''));
export const fmtSec = (s: number): string => (s < 10 ? s.toFixed(1) : s.toFixed(0)) + ' s';
export const plural = (n: number, word: string, many?: string): string => `${fmtNum(n)} ${n === 1 ? word : many ?? word + 's'}`;
export const day = (value: unknown): string => (value ? String(value).slice(0, 10) : '');
export const clip = (text: unknown, chars: number): string => { const s = String(text ?? ''); return s.length > chars ? s.slice(0, Math.max(1, chars - 1)) + '…' : s; };
export const cap = (s: unknown): string => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : '');
/**
 * A JSON key as words: "latest_value" -> "Latest value". A unit at the end keeps its case and goes in
 * brackets ("latest_value_g/dL" -> "Latest value (g/dL)"), rather than "g/d l".
 */
export const humanize = (key: unknown): string => {
  const text = String(key);
  const unit = /[_\s-]\(?([A-Za-z%µ]+\/[A-Za-z0-9]+|%)\)?$/.exec(text);
  const words = (unit ? text.slice(0, unit.index) : text).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return cap(words) + (unit ? ` (${unit[1]})` : '');
};
/** Parts joined by a separator, skipping empty ones. */
export function joined(parts: Child[], separator: Child = ' · '): Child[] {
  return parts.filter((p) => p !== null && p !== undefined && p !== '' && p !== false).flatMap((p, i) => (i ? [separator, p] : [p]));
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2023-06-14 as Jun 14, 2023, read from the text (no time-zone shift); times as recorded. */
export function fmtDate(value: unknown, { time = false } = {}): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T(\d{2}):(\d{2}))?/.exec(String(value ?? ''));
  if (!m) return value ? String(value) : '';
  const [, year, month, date, hour, minute] = m;
  let out = date ? `${MONTHS[Number(month) - 1]} ${Number(date)}, ${year}` : `${MONTHS[Number(month) - 1]} ${year}`;
  if (time && hour !== undefined && `${hour}:${minute}` !== '00:00') out += ` ${hour}:${minute}${/Z$/.test(String(value)) ? ' UTC' : ''}`;
  return out;
}
export function dateRange(start: unknown, end: unknown): string {
  if (!start) return 'undated';
  return day(end) && day(end) !== day(start) ? `${fmtDate(start)} – ${fmtDate(end)}` : fmtDate(start);
}
const UNITS: Record<string, string> = { Cel: '°C', 'degrees Celsius': '°C', '[degF]': '°F', 'mm[Hg]': 'mmHg', 'm[IU]/L': 'mIU/L', '10*3/uL': '×10³/µL', '10*9/L': '×10⁹/L', 'beats/minute': '/min', '{beats}/min': '/min' };
export const unitText = (unit: unknown): string => (typeof unit === 'string' ? UNITS[unit] ?? unit : '');
/** Initials for an avatar: "Jordan Synthetic0000Pair0" -> "JS". */
export const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

// ---------- JSON with highlighting ----------
const TOKEN = /("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
/** Highlighted JSON text as trusted markup. `isRef(s)` marks strings that are Type/id references (rendered as data-ref links). */
export function highlight(text: string, isRef: (s: string) => boolean = () => false): string {
  let out = '', last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += escapeHTML(text.slice(last, m.index));
    if (m[1] !== undefined && m[2] !== undefined) out += `<span class="j-key">${escapeHTML(m[1])}</span>${escapeHTML(m[2])}`;
    else if (m[1] !== undefined) {
      let value: unknown = null;
      try { value = JSON.parse(m[1]); } catch { value = null; }
      out += typeof value === 'string' && isRef(value)
        ? `<a class="j-str ref" href="#" data-ref="${escapeHTML(value)}">${escapeHTML(m[1])}</a>`
        : `<span class="j-str">${escapeHTML(m[1])}</span>`;
    } else if (m[3] !== undefined) out += `<span class="j-num">${m[3]}</span>`;
    else out += `<span class="j-lit">${m[4]}</span>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + escapeHTML(text.slice(last));
}
/** Indent JSON text that may be cut off (truncated tool responses). */
export function indentLoose(raw: string): string {
  let out = '', depth = 0, inString = false, escaped = false;
  const newline = () => '\n' + '  '.repeat(depth);
  for (const ch of raw) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; }
    else if (ch === '{' || ch === '[') { depth += 1; out += ch + newline(); }
    else if (ch === '}' || ch === ']') { depth = Math.max(0, depth - 1); out += newline() + ch; }
    else if (ch === ',') out += ch + newline();
    else if (ch === ':') out += ': ';
    else if (!/\s/.test(ch)) out += ch;
  }
  return out.replace(/([[{])\n\s*([\]}])/g, '$1$2');
}
export function prettyText(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text.trim().startsWith('{') ? indentLoose(text) : text; }
}

// ---------- storage and screen-reader announcements ----------
export const storage = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem('fhir-demo-' + key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem('fhir-demo-' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};
export function announce(text: string): void {
  const node = document.getElementById('announcer');
  if (!node) return;
  node.textContent = '';
  setTimeout(() => { node.textContent = text; }, 60);
}

// ---------- small shared UI pieces ----------
export const spinnerLine = (text: string): HTMLElement => h('div', { class: 'row muted small' }, h('span', { class: 'spinner' }), h('span', null, text));
export const emptyLine = (text: string): HTMLElement => h('div', { class: 'muted small' }, text);
export const failure = (text: string, retry?: () => void): HTMLElement =>
  h('div', { class: 'alert', role: 'alert' }, text, retry ? h('div', { style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn sm', onclick: retry }, 'Try again')) : null);

/** Place a .popover under (or above) an anchor and close it on outside click or Escape. Returns a close function. */
export function openPopover(anchor: HTMLElement, content: HTMLElement, { align = 'start' as 'start' | 'end', onClose = () => {} } = {}): () => void {
  const pop = h('div', { class: 'popover', role: 'dialog' }, content);
  document.body.append(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, hgt = pop.offsetHeight;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(12, Math.min(left, innerWidth - w - 12));
    let top = r.bottom + 6;
    if (top + hgt > innerHeight - 12 && r.top - hgt - 6 > 12) top = r.top - hgt - 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(12, top)}px`;
  };
  place();
  const close = () => {
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key, true);
    removeEventListener('resize', place);
    anchor.setAttribute('aria-expanded', 'false');
    onClose();
  };
  const outside = (e: Event) => { if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key, true);
  addEventListener('resize', place);
  anchor.setAttribute('aria-expanded', 'true');
  return close;
}
