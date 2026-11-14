# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t67-step-models`
(from `d61ee81`, not re-branched from `main`; rebase before the PR)

## NEXT: look at PQ-T70 on `/village` in the browser, then village / VR texturing

`make dev` + `LLM_PROVIDER=meta` → `/village` → validate a 2D front (and faces) → 3D
(scenarios V296–V313). Offline: `make views-3d FRONT=… | PHOTO=… [RIGHT= BACK= LEFT= TOP=] OUT=…`.

## PQ-T70 — the model wears its drawings (2026-11-13 / 14)

- `recipe.faces = { atlas, views, hull }` (`views` source only, `docs/contracts.md`): atlas = the
  validated drawings (never the photo) cut to the object (`recon/texture.ts`, `buildFaceAtlas`);
  hull = every front run × every side run per row, stacked into boxes (`lib/face-hull.ts`).
  The 3D object view draws the hull wearing the atlas (`facesMesh`, `face-projection.ts`).
- Refined on eight photos of `resources/refine-3d`: view from above (footprint, top texture,
  depth), roof ended at the eave (`eaveRow`), `ROOF_AGREEMENT`, pale blue paper.

## PQ-T71 — edit the surfaces, plan in the UI, drawings in the village (2026-11-14)

- Surface editor under the 3D view (`ui/surface-editor.tsx`, `faces.surfaces`, `restyleSurface`,
  `useObjectShape().restyle`); `hullMesh().surface` + `facesMesh` groups + `faceMaterials`.
- « Top view » is a 4th card of the 2D faces panel (`FACE_NAMES` + `top`, `faceUrls.top`).
- Village: `PlacedDrawnModelMesh` (cap 8, high tier); Blender: `drawnGroups` + embedded atlas.
- `dropGhosts` (plan contrast), bump relief, `roofClassOf` (geometry before the naming model).

## Decisions

- The hull uses the front and right silhouettes only (back / left drawings often disagree).
- The parts recipe stays for the flat render, the score, the low tier and models past the cap.
- No Neon migration (shapes not stored). No HF republish (bench unchanged).

## Open

- A chimney seen on one elevation only makes a thin fin; openings are lit relief, not geometry.
- VR spatial-shoot miniature = generic kit; the recipe `hip` and the score still read the class.
- Not committed (GPG passphrase needed): PQ-T69 rework, PQ-T70, PQ-T71. Shots:
  `~/Téléchargements/generated-view/<name>/planche.jpg`.
