# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t74-house-quality`
(from `feat/pq-t73-house-parts`; PQ-T67–T74 not on `main` yet; rebase before the PR)

## NEXT: try V335–V343 on `/village`, then open the phase PR (PQ-T67 → PQ-T75)

Brief and open limits: `docs/tasks/PV-house-generation-next.md` (§ « Traité en PQ-T74 » + what is left).
Offline replay: `make views-3d FRONT=… RIGHT=… BACK=… LEFT=… TOP=… OUT=… LABEL=house OFFLINE=1 READING=… MATERIALS=wood,slate`.

## PQ-T74 — house quality on five new house types (2026-11-14)

Live runs from photos (`resources/refine-3d/h-{thatch,fachwerk,stilt,logcabin,aframe}.jpg`, credits in
`SOURCES-refine.md`), each failure fixed in the pure fit / mesh, then replayed:

- `house-fit.ts`: `measuredBase` (base colour at the foot of the walls), `growToFootprint` (a strip along a
  block grows it), `ANNEX_PITCH`, chimney `finish: 'stone'`, `swatchOblique`, `lowerFinishes`
  (`HouseVolume.lower`), figured walls cut no wall swatch, bands of gable walls kept up to the ridge.
- `house-mesh.ts`: `THATCH_EDGE` (thick thatch eaves and verges), `EAVE_DROP_MAX`, lower cladding (gable
  walls cut level), chimney in the stone slot. `house-projection.ts`: thatch never wears the drawn swatch.
- `house-tools.ts`: prompt v2 (`figured`, `base`), `patchReading` (single reading completed by the
  specialists that answered), garbled colour keys read by their start. `recon/recipe.ts`: parts cut at 96.
- Results: `~/Téléchargements/generated-view/h-*/maison-3d-t74.jpg`, sheet `t74-sheet.jpg`.
- PQ-T75: `gableEnds` (hip → gable where windows sit in a peaked gable end), lower cladding behind
  verandas and in recesses (`maison-3d-t75.jpg` for fachwerk and stilt).

Next subject after the PR: cars, brief in `docs/tasks/PV-car-generation.md` (PQ-T76, start with its step 0).

## Decisions

- Zero-regression rule: `house-mesh.test.ts` hashes unchanged; bungalow single replay = `house-pq-t72.json`
  byte for byte. School single replay differs by `look.base` only (grey default → measured `#8a584b`):
  intended (limit 17), the brief's "red plinth" came from the reading being null there.
- `STRIP_MAX` 0.16 and `ANNEX_PITCH` 2 chosen so the bungalow's annexes stay as they were.
- New plan fields optional (`chimney.finish`, `volume.lower`). No Neon migration, no HF republish.

## Open

- `figured` and the v2 prompt were not run live yet (fachwerk replayed with the flag set by hand).
- Left: Muse views that disagree (views check + redraw), door snapped too wide (fix moves the bungalow reference).
