# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/pq-q1-pixels (pushed, PR to open; PR #10 merged)

## Current state

- **PV-Q Q1 (code done, 3 of 4 tasks unticked on purpose):** PQ-T7 ticked. PQ-T8 built but **off**
  (`KIT_TIGHT_CROP = false`), PQ-T9 and PQ-T10 built, each waiting for a measured gain.
- `make shape-report` after Q1: real mean 53 (baseline ≈ 54), synthetic 93, real colour ΔE 10.1 → no gain
  shown yet. Goldens unchanged.
- PQ-T37 still open: only `evidence.visibleParts` left (PQ-T12, Q2).
- Not done for PQ-T7: design gate screenshots (1440 + 390, dark + light) of the new hint line.
- Machine: if dev says `Can't resolve 'three'` → stop dev, `make install`.

## Next

1. Open the Q1 PR (one PR per phase), review + merge.
2. Paid runs to close Q1: `make eval-shape` with `KIT_TIGHT_CROP = true` (T8: agreement and counts not worse,
   else delete); `make sam-probe` on the hard real photos (T9: fewer « no outline »); per-part colour ΔE
   baseline vs now (T10). Then tick or revert.
3. Q2 from PQ-T11 (skill loader); PQ-T12 brings `evidence.visibleParts` and closes PQ-T37.

## Files touched (Q1)

- New: `server/perception/photo-conditions.ts`, `sam-consensus.ts`; `lib/photo-warning.ts`;
  `features/vision-insert/ui/photo-warning-line.tsx` (+ tests for each).
- Changed: `object-shape.ts` (conditions, facts, consensus, lit colours, part-mask timeout), `shape.ts`
  (`facts`, tight-crop lines), `shape-crop.ts` (`tightCropForShape`), `outline.ts` (`consensus`, `skipFull`),
  `part-masks.ts` (`partMasksTimeout`, `PART_RETRY`), `color-measure.ts` (`LIT_SHARE`, `litSurface`),
  `lib/object-shape.ts` (`conditions`), messages en/fr/mg (`photoTooSmall`, `photoBlurred`).
- Docs: `contracts.md`, `copilot.md`, `design/screens/village.md`, `tasks/PV-vision-quality.md`, loop log row.

## Decisions

- Blur does not lower colour confidence (it broke the goldens and does not move a median colour); only clipped
  exposure does.
- Shadow folding is opt-in (`litSurface`), off for plaster (beams and shadow look alike), never for groups in the
  secondary band, no chains (roof → shadow → wall merged everything).
- Consensus asks ≤ 3 SAM phrasings together; all-miss goes straight to the crop retry (`skipFull`).
- Test scenarios V235–V238 (`test-scenarios/06-village.md`, local).
