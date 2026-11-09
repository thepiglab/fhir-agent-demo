import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join class names, letting later Tailwind classes override earlier ones (shadcn/ui's cn). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
