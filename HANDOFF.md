# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-13 · **By:** Claude Code · **Branch:** `feat/pq-t67-step-models`
(from `d61ee81`, not re-branched from `main`: offline at start; rebase before the PR)

## NEXT: live test of PQ-T69 on Meta, then commit

Nothing committed: PQ-T67, PQ-T68 and PQ-T69 are all in the working tree.
Live check: `make dev` + `LLM_PROVIDER=meta` → `/village` → validate a 2D front (and faces) → 3D
(scenarios V289, V290, V294, V295). Offline: `make views-3d FRONT=… [RIGHT= BACK= LEFT=] OUT=…`.

## PQ-T69 — views reconstruction (this session)

- New `apps/web/src/server/perception/recon/` (pure TS + `route.ts`): mask per view → shared frame
  (front / right / back / left, mirrored views flipped) → shared CIELAB colour classes → per-class
  visual hull → surface slabs → score per view. Geometry is computed; one contributor call
  (`nameClasses`, step model `parts`) only names materials.
- `runObjectShape`: object with a 2D front or a photo crop → `reconstructObject` first
  (`model: 'views-reconstruction'`, `source: 'views'`); score < 0.5 or no views → photo pipeline
  (kit → template → code route), unchanged.
- Deleted: `facade-house`, `facade-views`, `object-views`, `view-stages`, `view-candidates`,
  `elevation-score`, `drawing-score`, `shape-stages`, `stage-steps`, `stage-sheet`,
  `house-facade-route`, their tests and fixtures; `make facade-e2e`, `photo-audit`, `eval-stages`.
- Backup of the tree before deletion: git ref `refs/backup/pre-recon` (`4d53373`, tracked files);
  untracked files were in a session tarball (temporary, may be gone).

## Decisions

- No per-archetype rule in the reconstruction: houses, cars, anything take the same code.
- `SHAPE_FOUR_FACES` now means « also draw back + left » for every object.
- No Neon migration (no stored shape changed). No HF republish (bench output unchanged).

## Verify

- `make check` green (2627 web tests, i18n 3/3); synthetic house / car ≈ 0.99; real drawing 0.76.

## Open

- Not live-tested; fidelity bounded by the 96-row grid and 32 parts; concavities no view shows are lost.
- Possibly orphaned: `views-check.ts` + `checkViews`, `graph-edits.ts`, `eval-code/shape.ts`.
