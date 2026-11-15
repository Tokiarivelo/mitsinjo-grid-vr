/**
 * FNV-1a 32-bit hash of a string (public domain algorithm): short stable keys for photos,
 * recipes and pattern seeds. Same input → same output, across sessions and machines.
 */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
