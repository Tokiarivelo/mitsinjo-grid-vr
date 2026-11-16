# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-16 · **By:** Claude Code · **Branch:** `feat/vs-t41-tour-mock-3d` (from `main` d3485390, VS-T41). Tasks in `docs/tasks/VR-village-spatial-shoot.md`.

## NEXT

1. VS-T41 scores below the stop (IoU ≥ 0.85, ΔE ≤ 8): 1/46 ok, mean IoU 0.77, 14 IoU ≥ 0.85, 22 ΔE ≤ 8. Worst: plants (palm .56, pines .55–.58, forest-tree-1 .59), lounge-sconce-2 .58, softbox .64, chandelier .66 / ΔE 27, cars ΔE 20–22, ceiling lights ΔE 26–32.
   Iterate specs in `server/perception/tour-mock/specs-*.ts`, `make tour-mock ONLY=<regex>`, look at `test-results/tour-mock/sheet-*.png`.
2. Ceiling lights: `renderFlat` shades a face seen from below at ≈ 0.5, so a white disc can't reach the photo's white. Fix needs lit (`kind: 'light'`) parts unshaded in **both** `renderFlat` and the 3D viewer (`surface-look.ts`), or the score drifts from the viewer.
3. Screen check V478–V483; headset later. Then previous NEXT: Vercel `vercel.json` (uncommitted on main side, owner's OK), headset S146–S161, V442–V477.

## Done this session (VS-T41)

- 46 hand-traced outlines (`tour/tour-outlines.ts`; tools `apps/web/scripts/tour-mock/`, `make tour-trace` → edit `outlines-src.mjs` → `make tour-outlines`); boxes derived from them; scan detections carry the projected outline (`projectPanoRings`).
- `server/perception/tour-mock/`: specs in metres (`spec.ts` helpers incl. `plate`/`rod`/`leaf`), `generate.ts` (pano rolled to the object, colours measured per part with occluder rejection, score), `render.ts`, `index.ts` (shape, part masks, coverage, face drawings), `tour-mock.json` (built by `make tour-mock`, ~4 min).
- Wired in mock mode: `/api/vision/shape`, `/api/vision/views`, facade + faces (`mockFaceDrawing`).
- `loft-hood` relabelled « Hotte de cuisine ».

## Decisions

- Mock never pastes the photo: colours measured only; plant models from `reconstructTree` on the outlined photo (as the real path).
- Real Meta path untouched (`perception.callsMeta` → normal pipeline).
- No Neon migration, no HF dataset change (mock answers, not bench).

## Open

- `make check`: `recon` / chart time-budget tests flake under full-suite load (pass alone).
- Commits need the GPG key unlocked (signing on).
