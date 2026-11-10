# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-10 · **By:** Claude Code · **Branch:** docs/vision-to-3d-refine (from `main`, docs only)

## Current state

- **Photo → 3D docs rewritten (no code changed).** `docs/vision-to-3d-methodology.md` now describes the real
  pipeline (`server/perception/`), audits the old claims, ranks 15 weak points and lists every file to add or change.
- **Main finding:** `make shape-report` says 93 / 100 on five **synthetic** pictures while the ¾ renders are still
  boxy (car = slab + wedge, fridge without handle). The score sees outline and colour only; the critic fires
  under 70 on a 256 px sheet. Nothing can be judged until the ruler is fixed.
- **New:** `docs/vision-to-3d-muse-skills.md` (prompt-ready cards: base, look, kit, 13 archetype cards, critic,
  stage ops, views check, final check, judge, Muse Image views, SAM wording). Target texts, not in the code yet.
- **New:** `docs/tasks/PV-vision-quality.md` (PV-Q, PQ-T1…T35: task, files, test, done-when).
- **Rendering audit** (methodology § 11): four renderers draw the same recipe unequally. Viewer has no
  part-on-part shadow or AO; the village draws all placed objects with one material; VR has no maps. Tasks PQ-T32–T35.
- **Moved:** cloud and sun maths → `docs/vision-to-3d-atmosphere.md` (word for word, not re-audited).
- VR state unchanged (merged in `main`): /village walkable 360° tour, outdoor walk, `make vr-probe` 15 PASS.

## Next

1. **PQ-T1** real reference set: ≥ 12 photos with `make shape-capture PHOTO=… ID=…` (costs Meta API calls; needs
   the user's photos). Then **PQ-T2** detail score, **PQ-T3** flat render draws details.
2. Only after Q0: Q1 (pixels, SAM agreement) → Q2 (skill cards, one family at a time, each with an eval).
3. VR backlog as before: real Quest check, tour links, headset static text → i18n keys, VS-T9 audio.

## Files touched

- `docs/vision-to-3d-methodology.md` (rewrite), `docs/vision-to-3d-muse-skills.md` (new),
  `docs/vision-to-3d-atmosphere.md` (new, split), `docs/tasks/PV-vision-quality.md` (new), `docs/tasks/README.md`
- `.claude/skills/shape-3d/SKILL.md`, `.claude/skills/shape-loop/SKILL.md`, `CLAUDE.md` (doc map row)

## Decisions

- Q0 (measure on real photos, detail score, calibrated judge) comes before any prompt or geometry work.
- Skill cards are texts for the Muse models, loaded per call and per archetype; a card replaces a prompt only
  when its eval is not worse. Kit stays on Spark 1.3; Wonder = final check and judge only.
- Muse Image: side view and operator-validated clean front only; top and back views are never generated (PR-4.1).
- Unverified claims of the old file (prices, context sizes, « Passed » table, `scratch/test-orbit.mjs`) removed.
- Open for the user: which real photos to capture for PQ-T1; whether to spend API calls on two kit samples (PQ-T18).
