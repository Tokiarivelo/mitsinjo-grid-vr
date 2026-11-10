# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/pq-t37-part-list (PR open; Q0 PR #9 merged)

## Current state

- **PV-Q phase Q0:** PQ-T1–T6, T36 done. PQ-T37 almost done: « Not built » explained for every real object,
  panel part list shipped; only `evidence.visibleParts` left (waits for Q1 PQ-T12).
- **Real baseline (15 of 16 scored, Wikimedia Commons photos, local only):** mean ≈ 54 vs synthetic 93. Judge
  77 % of 13 pairs < 90 % → developer note only. Only the solar street light has no outline (PQ-T9).
- Photos: `resources/real-photos/` and `__fixtures__/shape/real/photos/` (+ `SOURCES.md`), gitignored.
- Machine: if dev says `Can't resolve 'three'` → stop dev, `make install` (broken install since the full disk).

## Next

1. Review + merge the PQ-T37 part-list PR.
2. Q1 from PQ-T7; PQ-T12 brings `evidence.visibleParts` (then close PQ-T37); PQ-T9 has the SAM evidence.

## Files touched (this session, after PR #9)

- `server/perception/mask-geometry.ts` (`masksOnObject`), `score-shape.ts`, `shape-report.ts`: only SAM masks on
  the object's outline count as seen (commit 1086347, on main).
- `server/perception/object-graph.ts` (`partCoverage`), `object-shape.ts` (`coverage` on the result),
  `lib/object-shape.ts` (`PartCoverageSchema`, `ObjectShape.coverage?`).
- `features/vision-insert/ui/part-coverage-line.tsx` (new) + `object-shape-panel.tsx`, messages en/fr/mg, tests.
- Docs: `contracts.md`, `design/screens/village.md`, `design/stitch-map.md`, `tasks/PV-vision-quality.md`.

## Decisions

- Part list = per SAM concept « built/seen »; missing ones get « not built: n » with a `warning-amber` icon only
  (amber text fails AA on light). Shown only for AI shapes with part masks; no plurals (no ICU in the i18n wrapper).
- Built without mockup; gate-out 1440 + 390, dark + light, stubbed shape (temp script deleted).
- Test scenarios V233–V234 (`test-scenarios/06-village.md`, local).
