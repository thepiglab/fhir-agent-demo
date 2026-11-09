// Light, dark or follow the system. Sets `.dark` on <html> (Tailwind / shadcn) and
// data-theme (the plain-TypeScript chart panel's tokens.css).
import { storage } from '../app/dom.ts';

export type Theme = 'auto' | 'light' | 'dark';
const media = window.matchMedia('(prefers-color-scheme: dark)');
let current: Theme = storage.get<Theme>('theme', 'auto');
const listeners = new Set<(t: Theme) => void>();

function apply(): void {
  const dark = current === 'dark' || (current === 'auto' && media.matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  if (current === 'auto') delete root.dataset.theme; else root.dataset.theme = current;
}
media.addEventListener('change', apply);
apply();

export const getTheme = (): Theme => current;
export function setTheme(theme: Theme): void {
  current = theme;
  storage.set('theme', theme);
  apply();
  for (const fn of listeners) fn(theme);
}
export function onTheme(fn: (t: Theme) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
