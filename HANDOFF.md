# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/pq-q1-pixels (PR #11 open; PR #10 merged)

## Current state

- **PV-Q Q1 measured and closed as far as the data allows:**
  - PQ-T7 photo conditions: in, ticked (design-gate screenshots of the hint line still to do).
  - PQ-T8 tight crop: **reverted** (`make eval-shape` 98/118 vs 99/116, median 28.9 vs 24.5 s, window counts worse).
  - PQ-T9 SAM agreement: `make outline-compare` 12/13 = plain 12/13 → **off** (option kept, tested). Part-mask retry
    and time share stay. Only miss: solar street light (SAM returns the panel alone).
  - PQ-T10 lit colours: in, unticked — shape-report identical with and without it (no shadowed wall in the real set).
- Real baseline unchanged: mean 53 (synthetic 93). PQ-T37 open: only `evidence.visibleParts` (PQ-T12, Q2).
- Machine: if dev says `Can't resolve 'three'` → stop dev, `make install`.
- Full vitest run: facade-masks stage loop + golden car/fridge/tree failed once under full-suite load, pass alone.

## Next

1. Merge PR #11 once CI is green.
2. Design gate for the new hint (`photoTooSmall` / `photoBlurred`): 1440 + 390, dark + light (needs a real run).
3. Q2 from PQ-T11 (skill loader); PQ-T12 brings `evidence.visibleParts` and closes PQ-T37.

## Files touched (Q1)

- New: `server/perception/photo-conditions.ts`, `sam-consensus.ts`; `lib/photo-warning.ts`;
  `features/vision-insert/ui/photo-warning-line.tsx`; `__tests__/outline-compare.test.ts` (+ tests).
- Changed: `object-shape.ts` (conditions, facts, lit colours, part-mask timeout), `shape.ts` (`facts`),
  `outline.ts` (`consensus`, `skipFull`), `part-masks.ts` (`partMasksTimeout`, `PART_RETRY`), `color-measure.ts`
  (`LIT_SHARE`, `litSurface`), `lib/object-shape.ts` (`conditions`), messages en/fr/mg, Makefile `outline-compare`.
- Docs: `contracts.md`, `copilot.md`, `design/screens/village.md`, `tasks/PV-vision-quality.md`, loop log row.

## Decisions

- Blur does not lower colour confidence (broke the goldens); only clipped exposure does.
- Shadow folding opt-in (`litSurface`), off for plaster, never for the secondary band, no chains.
- Test scenarios V235–V238 (`test-scenarios/06-village.md`, local).
