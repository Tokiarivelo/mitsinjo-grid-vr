# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-11 · **By:** Claude Code · **Branch:** feat/pq-q2-muse-skills (PR #13, rebased on `main`, reviewed)

## Current state

- **PV-Q Q2 code built, one commit per task, all unticked** (their « done when » needs live Meta calls; nothing
  new is on by default, so the demo path and the real baseline are unchanged):
  - PQ-T38 stage stops `repeat` / `back_and_forth` (always on) · PQ-T18 `SHAPE_KIT_SAMPLES=2` (`kit-vote.ts`).
  - PQ-T14 critic v2 (`criticPromptVersion` 2): 2 × 2 sheet, 4-field patch, ≤ 3 live rounds (not via `shape-jobs`).
  - PQ-T15 `SHAPE_LOOP_CARDS=true` (loop cards) · PQ-T16 `SHAPE_SIDE_V2=true` (side card, 2 candidates scored).
  - PQ-T17 `effort.ts`: per call kind, all `high`; accepted `reasoning_effort` values NOT confirmed on Meta.
  - PQ-T41 `ObjectShape.ask` + `FamilyQuestion` (asks on a kit split) · PQ-T13 `SHAPE_KIT_CARD_FAMILIES` (prompt 3).
- **PR #13 review (2026-11-11):** `repeat` no longer stops an op kept at a part of its step (it was cutting a
  stage that still gained); `family-cards.test.ts` no longer needs the gitignored real set (CI); tests added
  (critic v2 rounds, vote → question, side v2 candidates, `archetypeOf`, stop labels).
- **Real set: 24 captures** (was 16). `make family-photos` + `make shape-capture` added tank, panel, bush,
  animal, person (1 each), a topiary tree, 2 houses. `building` has none: 3 real buildings were answered `house`.

## Next

1. Merge PR #13 once CI is green (not merged by the review: every task is still unticked).
2. `make eval-shape PROMPT=1,3` (≈ 45 min with 24 captures, alone) → set the families marked `on` in `.env`.
   The 5 new families are `thin` (1 capture): add a second photo each to `family-photos.json` for a verdict.
3. With a Meta key, measure each flag against its « done when » (one at a time): T18, T14, T15/T16 (record
   `make facade-e2e` loops under both settings first: only 1 recorded), T17 (probe effort values), T41.
4. PQ-T41 design gate-out (screenshots of the question, both themes, 390 px) needs a live kit split; no mockup.
5. Why does the kit call answer `house` for a 4-floor block? (`apartment.capture.json`, hint was `building`.)

## Files touched (review)

- `shape-stages.ts`, `object-shape.ts` (dead branch), tests beside; `scripts/fetch-fixture-photos.sh`
  (was `fetch-shadow-photos.sh`, now takes the manifest name), `__fixtures__/shape/family-photos.json`, `Makefile`
  (`family-photos`), `README.md`, `docs/copilot.md`, `docs/tasks/PV-vision-quality.md`.

## Decisions

- Every new Muse behaviour is opt-in (env or option) until its eval is shown, like prompt 2 of PQ-T12.
- T41 shows the question beside the first model, not before the build (no hidden model for one tap).
- Real photos stay local (gitignored); only their manifest is committed. Scenarios V242, V243 (local).
