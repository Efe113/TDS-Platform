import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * tailwind-merge matters here: a component's own `px-3 py-2` and a caller's `p-4` should not both
 * survive into the class list, which is what made the hand-rolled join version leak conflicts.
 */
export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values))
}
