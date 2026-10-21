import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Same helper as the old site (lib/utils): merge Tailwind classes. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
