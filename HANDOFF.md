# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-17 · **By:** Claude Code · **Branch:** `feat/vs-t41-tour-mock-3d` (VS-T41 + VS-T42, from `main` d3485390). Tasks in `docs/tasks/VR-village-spatial-shoot.md`.

## NEXT

1. User request (2026-11-17): generalise the specialist agents (facade, plant team, views…) to every kind of object and make some reusable; else add 3D specialists per object class and fill the gaps in the general generation agents. Survey `server/perception/` specialists first, then write a task (VS-T43 or a P-task).
2. VS-T42 weak objects (IoU < 0.6): open furniture (bedroom-shelf .19, stools .26–.47, director chair .38, side tables .38, woods-bridge .28, arches .30, railings .38). Filled outline counts the background seen through: score with a part-aware mask or model the openings.
3. Hull renders show thin white stripes at section vertices in `renderFlat` (rocks, silhouette crowns): check hull triangulation.
4. Ceiling lights ΔE (flat shading from below), see VS-T41 note; screen check V478–V488; headset later.

## Done this session (VS-T42)

- 113 more tour objects (159): `tour-data.ts`, outlines in `scripts/tour-mock/outlines-src-2.mjs` (pano format) → `tour-outlines.ts`.
- Name card only under the laser (`holo-detection-target.tsx` + test).
- `tour-mock/specs-extra.ts` (furniture helpers: sofa, chair, stool, bed, table, glazing, door, curtain, cabinet, railing, fence, planter, tyre, rock).
- Generator: `tour-mock/silhouette.ts` (outline as hull front, band clip, spike drop, plant fallback) + `generate.ts` (`partsEntry`/`finishEntry`, plant fallback under IoU 0.45) + test `tour-mock-silhouette.test.ts`.
- 10 new `model3dPart` concepts (seat, backrest, cushion, mattress, curtain, pot, shelf, rail, mirror, flower), en/fr/mg.
- Scores 159: mean IoU 0.76, 55 IoU ≥ 0.85, 75 ΔE ≤ 8.

## Decisions

- Silhouette parts use the traced outline shape only, never photo pixels (rule: no photo on models).
- Outline crowns read as cushions: the plant fallback only replaces clearly broken readings.
- Cylinder `size` is the world box: a lying rod is `[len, d, d]` with `axis: 'x'`.
- No Neon migration, no HF dataset change (mock answers, not bench).

## Open

- `make check`: `recon` / chart time-budget tests flake under full-suite load (pass alone).
- Commits need the GPG key unlocked (signing on).
