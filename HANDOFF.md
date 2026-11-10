# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/pq-t2-detail-score (Q0, PR #9 open)

## Current state

- **PV-Q phase Q0:** PQ-T1, T2, T3, T5, T6, T36 done; PQ-T4 judge coded, calibration not run (API); PQ-T37 partial.
- **Real baseline (12 captures, Wikimedia Commons photos, local only):** mean 55 vs synthetic 93 (IoU 0.72,
  edge F1 0.38, ΔE 9.9). Worst lamp 32, car-hidden 38, motorbike 40; best fridge 92. Gates `STOP_DETAIL`.
- Photos: `resources/real-photos/` (copy to check) and `__fixtures__/shape/real/photos/` (+ `SOURCES.md`), gitignored.
- Fixes found by the live captures: parts clamped into the schema, capture keeps the on-demand outline,
  SAM gets the head noun + one retry with the full label (`make sam-probe` measures words).
- Machine: shared `node_modules` broken since the full disk (React typings) → `make install`.

## Next (user first) — French guide: `docs/tasks/PV-Q0-a-faire.md`

1. Re-capture `utility-pole` (label fix) and `car-corner` (no LABEL needed now): `make shape-capture …`.
2. **PQ-T4:** `make shape-judge` (API, ~2 calls per capture) → calibration in the loop log.
3. Then Q1 from PQ-T7; PQ-T9 has the SAM evidence (pump unknown to SAM, solar light returns a part).
4. PQ-T37 open: `evidence.visibleParts` (PQ-T12), part list in the panel (UI task).

## Files touched (this session, after the Q0 code)

- `server/perception/`: `outline.ts` (head noun, label retry), `object-shape.ts` (clamp, retry), `shape-capture.ts`
  (`pickDetection`), `model-score.ts` (`weightDetail`), `score-shape.ts`, `shape-report.ts` (`STOP_DETAIL`),
  tests incl. `sam-probe.test.ts`; `lib/object-shape.ts` (`clampParts`)
- `Makefile` (`sam-probe`, `shape-capture LABEL=`), `.gitignore` (`/resources/`), `README.md`, `docs/copilot.md`,
  methodology §9 + tools table, `.claude/skills/shape-loop`, `docs/tasks/PV-vision-quality.md`, `PV-shape-realism.md`,
  `PV-Q0-a-faire.md` (new, French)

## Decisions

- Real photos come from Wikimedia Commons (free licences), stay local; hard set: hidden car, small pole, backlit panel.
- Detail weights replace the landmark set when part masks exist; goldens keep their scores.
- No extra SAM phrasings in the live path yet (each miss costs up to 16 s): that is PQ-T9.
- No test scenario: developer tooling and pipeline internals, nothing new visible in the app.
