# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t67-step-models`
(from `d61ee81`, not re-branched from `main`; rebase before the PR)

## NEXT: try PQ-T72 on `/village` in the browser, then open the phase PR

`make dev` + `LLM_PROVIDER=meta` → `/village` → validate a house's 2D faces → 3D (scenarios V314–V327).
Offline: `make views-3d FRONT=… RIGHT=… BACK=… LEFT=… TOP=… OUT=… [READING=house-reading.json]`.

## PQ-T72 — house specialist (2026-11-14)

- `readHouse` (Spark, high effort, streamed, sent through `longFetch` = `node:https`: fetch drops a
  silent call after 300 s) reads the validated drawings → `HouseReading` → `fitHouse` snaps it on the
  pixels (outline steps, ridge, shed fall front first, openings on their frames, owner block, footprint
  annexes from the view from above, low decks) → `recipe.house` (`lib/house-plan.ts`).
- `lib/house-mesh.ts`: openings with reveal / frame / sill / bars, one roof per volume, walls up to
  their roof line, verandas (hosted = recess), balconies, chimneys, a plinth under every closed block.
- Look: a clean swatch of wall (front) and of roof (top) cut on the drawings (`housePatches` on a
  480-col grid, `cropPatch`, `cleanSwatch` = boards to their median profile), mirrored-repeated; the whole
  drawing only when the operator picks « Dessin ». Viewer / village / Blender share `houseSlotLooks`.
- Boards: `~/Téléchargements/generated-view/<name>/maison-3d.jpg` (8 houses).

## Three.js duplicate fix

`@iwer/devui` brings its own three 0.184: the DevUI loads only on « enter VR » (`installDevXRPanels`).

## Decisions

- One reading for the whole house (not per room): coherent volumes, openings owned by block.
- One wall swatch per house (the front's dominant cladding); mixed claddings become one.
- No Neon migration (recipes not stored). No HF republish (bench unchanged).

## Open

- Arched heads, dormers and glazed gables are rectangles.
- Generated views that disagree (house-detached: front vs top) still misplace blocks.
- Blender export colours swatch slots (no swatch image).
