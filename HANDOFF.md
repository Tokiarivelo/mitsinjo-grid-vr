# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-17 · **By:** Claude Code · **Branch:** `feat/vs-t46-tour-outdoor-faces` (VS-T46, plus VS-T47 commits from a parallel session, from `main` 2707dfac). Tasks in `docs/tasks/VR-village-spatial-shoot.md` and `docs/tasks/PV-specialist-teams.md`.

## NEXT

1. PV-specialist-teams PQ-T89/T90: `STRUCTURE_TEAM` can build on `ironRailing` / `latticeTower` (`furniture/structure.ts`); plant team: ask the pilot « pot or ground » and fill `PlantHints.ground` (promptVersion + 1).
2. Colour score of white walls / planters (ΔE 15–30): `measurePartColors` scales the base by photo / shaded render, white clips at 255 while ΔE compares the unshaded colour. Decide one convention for all 159 (photo median as for plants?) and rerun `make tour-mock`.
3. Weak tour objects: cypresses and dark pines (IoU 0.58–0.68), woods-bridge 0.28, street-lamp-2 0.53; open structures need a part-aware outline mask to be scored fairly.
4. Screen check V515–V520 (`test-scenarios/06-village.md`), headset later.

## Done this session (VS-T46)

- Plants scored, drawn on sheets and imagined from the `plantMesh` the viewer shows: `tour-mock/plant-render.ts` (z-buffer, slot colours, leaf tone, crown self-shade).
- `tour-mock/plant-clean.ts`: outlined photo cleaned for the tree reader (sky gaps → leaf green, backlit crown tinted, trunk strays dropped); `buildEntry` keeps the better of raw / cleaned reading.
- Plant look measured on the photo without sky (`measurePlantLook`, `measureGroupColors` shared with parts).
- `PlantHints.ground` (no pot search, `tree-recon.ts`); outdoor tour plants grounded in `specs.ts`.
- `ironRailing`, `latticeTower`, `barRibbon`, `sCurve`, `cScroll` builders; terrace railings, pylon, garden-tree-1 / -2 respecified.
- `IMAGINED_LOOK = 2`; `make tour-faces` run (all faces in `node_modules/.cache/tour-imagined/`).
- Scores: outdoor plants IoU 0.69 → 0.77; tour IoU ≥ 0.85 55 → 62, ΔE ≤ 8 75 → 81.

## Decisions

- Plants are scored level (pitch 0): read as the photo's front, a panorama keeps verticals.
- A plant's look is the photo median (its light is in the photo), not shading-compensated like parts.
- Open iron / steel keep fixed colours: what shows between the bars is the background.
- The cleaned photo is only read, never shown or projected (rule: no photo on models).
- No Neon migration, no HF dataset change (mock answers, not bench).

## Open

- `xr-layout.test.ts` had a duplicate `MENU_INPUTS_OFFSET` from the parallel XR session mid-work: recheck typecheck.
- `make check`: `recon` / chart time-budget tests flake under full-suite load (pass alone).
