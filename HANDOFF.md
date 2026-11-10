# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/pq-t2-detail-score (Q0, PR #9 open)

## Current state

- **PV-Q phase Q0:** PQ-T1–T6, T36 done; PQ-T37 partial (needs Q1 PQ-T12 + a UI task). Judge calibrated:
  73 % of 11 pairs < 90 % → developer note only (it grades most models 1–2).
- **Real baseline (12 captures, Wikimedia Commons photos, local only):** mean 55 vs synthetic 93 (IoU 0.72,
  edge F1 0.38, ΔE 9.9). Worst lamp 32, car-hidden 38, motorbike 40; best fridge 92. Gates `STOP_DETAIL`.
- Photos: `resources/real-photos/` (copy to check) and `__fixtures__/shape/real/photos/` (+ `SOURCES.md`), gitignored.
- Fixes found by the live captures: parts clamped into the schema, capture keeps the on-demand outline,
  SAM gets the head noun + one retry with the full label (`make sam-probe` measures words).
- Machine: shared `node_modules` broken since the full disk (React typings) → `make install`.

## Next (user first) — French guide: `docs/tasks/PV-Q0-a-faire.md`

1. Re-capture `pump` and `car-corner` when the Meta API stops timing out on image calls (ETIMEDOUT
   2026-11-10 evening; pump's outline now found via the « fire hydrant » lookalike). Pole re-captured (33).
2. Then Q1 from PQ-T7; PQ-T9 has the SAM evidence (solar street light returns one part).
3. PQ-T37 open: `evidence.visibleParts` (PQ-T12), part list in the panel (UI task).

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
