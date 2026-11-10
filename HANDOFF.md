# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** feat/pq-t2-detail-score (from `main`)

## Current state

- **PQ-T2 done: detail score.** `server/perception/detail-score.ts` `scoreDetail`: part recall, part precision,
  interior edge F1, part ΔE (methodology §6.1, as-built note there). `scoreRecipe` attaches it as
  `ModelScore.detail`; not weighted into the score. `make shape-report` shows four new columns.
- Golden mean 93 unchanged (IoU 0.98, edge 0.91, ΔE 3.4). No golden has SAM part masks, so recall / precision /
  part ΔE show « — ». Interior edge F1: car 0.81, lamp 0.31, cottage 0.17, **fridge 0, tree 0**: the ruler now
  sees what the outline score missed (fridge without handle).
- PQ-T1 (real photo set) still open: needs the user's photos and API calls. Its real rows will fill the columns.
- VR state unchanged (in `main`).

## Next

1. **PQ-T1** real photo set (`make shape-capture PHOTO=… ID=…`, user's photos, API calls).
2. **PQ-T3** flat render draws assembly details (frames, panes, handles, rims) — offline, next agent task.
3. Then PQ-T36 (interior difference, other angles), PV-C (PC-T1, PC-T9).

## Files touched

- `apps/web/src/server/perception/detail-score.ts` (new) + `__tests__/detail-score.test.ts` (new, 10 tests)
- `model-score.ts` (`detail` field, `matched` exported), `score-shape.ts` (`detailParts`, `gridParts`),
  `shape-report.ts` + `__tests__/shape-report.test.ts` (four columns)
- `docs/vision-to-3d-methodology.md` §6.1, `docs/tasks/PV-vision-quality.md` (PQ-T2 ticked),
  `docs/tasks/PV-shape-realism.md` (loop log row), `.claude/skills/shape-3d/SKILL.md` (score row)

## Decisions

- Untagged kit parts get the landmark guesses (axis-z cylinder below body = wheel, thin box = window or door).
- Part ΔE compares the SAM box on the photo with the same pixels on the shaded render (an exact model → 0),
  not with the unshaded part colour (which gave ΔE 7 on an exact model).
- Interior edge F1 is 1 when neither side has interior edges ("nothing to draw, nothing drawn").
- No test scenario: dev report only, nothing visible in the app.
