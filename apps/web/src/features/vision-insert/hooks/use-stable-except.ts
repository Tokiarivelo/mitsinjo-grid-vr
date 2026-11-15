import { useState } from 'react';

/**
 * The same object as last render while only `key` changed (every other field identical): a
 * recipe whose piece edits change (PQ-T77) keeps its identity, so its mesh is not rebuilt.
 */
export function useStableExcept<T extends object>(value: T, key: keyof T): T;
export function useStableExcept<T extends object>(value: T | null, key: keyof T): T | null;
export function useStableExcept<T extends object>(value: T | null, key: keyof T): T | null {
  // Derived state: a real change is adopted during this render (React re-renders at once).
  const [kept, setKept] = useState<T | null>(value);
  if (kept !== value && !sameExcept(kept, value, key)) {
    setKept(value);
    return value;
  }
  return kept;
}

/** Whether two objects are equal field by field (`===`), `key` aside. */
export function sameExcept<T extends object>(a: T | null, b: T | null, key: keyof T): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof T>);
  for (const k of keys) if (k !== key && a[k] !== b[k]) return false;
  return true;
}
