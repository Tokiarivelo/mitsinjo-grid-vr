# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/pq-t2-detail-score (Q0, PR open)

## Current state

- **PV-Q phase Q0 coded, one commit per task:** PQ-T2 detail score · PQ-T1 « Real » table (code) · PQ-T3 judge
  render draws the viewer's assemblies (`expandAssemblies`, shared) · PQ-T5 prompt versions (`PROMPT=1,2`) ·
  PQ-T36 worst height band + degenerate view · PQ-T37 floating / fused / not-built gates (partial) · PQ-T4 rubric
  judge (code, `make shape-judge`).
- **Real baseline (3 captures):** mean 60 vs synthetic 93. Lamp 32 (4 blank bands), fan 55 (falls in 2 pieces at
  45°), fridge 92. TV capture has no outline (not scorable). Goldens unchanged; thatched elevation 99 → 97.
- Machine: disk was full mid-session (freed by the user); shared `node_modules` now gives ~780 JSX type errors
  in files this branch never touched (React / three typings) — same on `main`: reinstall (`make install`).

## Next (user first) — step-by-step guide in French: `docs/tasks/PV-Q0-a-faire.md`

1. **PQ-T1:** capture the 12 missing real photos (`make shape-capture PHOTO=… ID=<id> LABEL=<detection>`,
   ids in `REAL_SHAPES`), re-capture `TV`. Then `make shape-report`.
2. **PQ-T4:** `make shape-judge` (API) → calibration in the loop log.
3. **PQ-T6:** gates from the real baseline (needs 1). Then Q1 (PQ-T7…).
4. PQ-T37 open parts: `evidence.visibleParts` (PQ-T12), part list in the panel (UI task).

## Files touched

- `server/perception/`: `detail-score.ts`, `rubric-judge.ts` (new), `model-score.ts`, `score-shape.ts`,
  `flat-render.ts`, `object-graph.ts`, `object-shape.ts`, `shape-report.ts`, `shape-capture.ts`, `eval-shape.ts`,
  `shape.ts`, `views-check.ts`, `facade-views.ts`, `meta.ts`, `client.ts`, `mock.ts`, `backend.ts`, `schemas.ts`,
  `__fixtures__/shape/index.ts`, tests (+ `golden-run.ts` `writeGoldenCapture`)
- `features/vision-insert/utils/assembly-parts.ts` (new), `object-geometry.ts`; `lib/env.ts` (`META_JUDGE_MODEL`)
- `Makefile` (`shape-judge`, `eval-shape PROMPT=`), `.env.example`, `README.md`, `docs/copilot.md`,
  `docs/vision-to-3d-methodology.md` §6, §11, `docs/tasks/PV-vision-quality.md`, `PV-shape-realism.md` (loop log)

## Decisions

- Detail numbers are reported, never weighted, until PQ-T6. Part ΔE compares the same pixels on photo and render.
- Turned views frame on recipe parts only (a chimney cap no longer rescales the elevation).
- Live judge / capture tools stay vitest blocks (run TS server code), not `.mjs` scripts.
- No test scenario: developer report and pipeline internals only, nothing visible in the app.
