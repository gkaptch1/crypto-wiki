import { createHash } from 'node:crypto';
import type { MacroMap } from '@crypto-wiki/shared';

// Content hash of a macro map, key-sorted so semantically equal maps always
// hash identically. This is what ?macros=<uuid>@<hash> pins.
export function macroHash(macros: MacroMap): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(macros).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
  return createHash('sha256').update(canonical).digest('hex');
}
