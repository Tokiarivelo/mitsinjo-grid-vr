---
name: shape-loop
description: Quality loop for the object 3D models — run the shape report, read the scores and contact sheet, fix the worst metric on the worst object, re-run, log the iteration, and stop on the plan's criteria. Use after any 3D shape change, or as `/loop /shape-loop` to iterate autonomously toward a good result.
---

One iteration = measure → pick → fix one thing → measure → log. Plan and stop criteria: `docs/tasks/PV-shape-realism.md`.
The five golden pictures are synthetic drawings: a high score on them does not mean a real photo looks right
(`docs/vision-to-3d-methodology.md` § 3). Until PQ-T1 and PQ-T2 of `docs/tasks/PV-vision-quality.md` land, also
look at the ¾ column of the sheet and say what a person would still find wrong.

1. **Measure.** `make shape-report`: the table (with the « Next » object and metric) is printed in the output and
   written to `test-results/shape-report/index.md`; look at `contact-sheet.png` once (photo | flat render | ¾ render).
   `SHAPE_REPORT_DIR=<dir>` writes them elsewhere. Look tasks (light, materials): `make shape-shots` (dev server
   running) shoots the real viewer for each recipe, dark + light, into `viewer/` (`SHOT_SUFFIX=before` to compare). The renderer itself can be wrong: an artifact on the sheet
   (holes, combs, missing part) is a `flat-render.ts` bug to fix first, with a regression test.
2. **Pick.** The object with the lowest score; on it, the worst metric against the stop criteria (IoU, edge F1, ΔE,
   part counts, designer score). Name the cause in one line, pointing at code (`file:function`). If the cause is a
   missing capability, take the next unchecked plan task that provides it instead of a hack.
   For a wrong **what** (sub-type, counts, proportions, part colours), ask Spark first: crop | flat render side by
   side → kit patch (`/shape-3d` « Meta in the render loop »), on captured fixtures; keep only patches that raise
   the score, and turn the repeated corrections into prompt lines.
3. **Fix one thing** with `/shape-3d` rules. Add or update a test that fails before the fix.
4. **Measure again.** Any metric down > 2 points on any object → fix or revert before step 5. Never tune a
   threshold just to pass one golden case: the change must make sense for a real photo.
5. **Review** every 3rd iteration or after a « Look » task: `/designer-3d` on the ¾ sheet, ≤ 3 issues, score 1–5.
6. **Log** one row in the plan's « Loop log » (date, task / fix, mean IoU, edge F1, mean ΔE, designer, note); tick the
   task; commit (+ push) with the scores in the message.
7. **Stop** when every object meets the criteria, or after 3 rounds on the same issue without gain → report to the
   user with the sheet and the blocking cause. In `/loop` mode, end the loop on either.

Report to the user: outcome first (scores before → after), what changed, what is still below target.
