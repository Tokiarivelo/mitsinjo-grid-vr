# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-14 · **By:** Claude Code · **Branch:** `feat/pq-t73-house-parts`
(from `feat/pq-t67-step-models` @ `5a129af`, PQ-T67–T72 not on `main` yet; rebase before the PR)

## NEXT: try PQ-T73 on `/village` (V328–V333), then open the phase PR (PQ-T67 → PQ-T73)

`make dev` + `LLM_PROVIDER=meta` → `/village` → validate a house's 2D faces → 3D.
Offline: `make views-3d FRONT=… RIGHT=… BACK=… LEFT=… TOP=… OUT=… [READING=…] [SINGLE=1]`.

## PQ-T73 — piloted part specialists (2026-11-14)

- `house/house-tools.ts`: pilot (`housePilot`, medium) → `HouseBrief` (type, parts, focus note per tool);
  tools `massing` / `openings` / `structure` / `finishes` (`houseTool`, high, streamed) in parallel,
  merged into one `HouseReading` (replayable). Massing retried once; 12 min deadline per call
  (`HOUSE_TOOL_TIMEOUT_MS`: a hung stream held a whole house 18 min). No massing → PQ-T72 single reading.
- Plan parts: piers (stone, cap, course; replace posts on their side when ≥ half the beam height),
  heads arch / segment / bracket + arcade bays, gable trusses, galleries (balcony with posts under the
  main eave; flat skirt when no roof covers it), `wallFinish` / `roofFinish`, finishes wall2 / stone /
  roof2 / timber with colour + swatch measured in the specialist's sample box. New slots appended.
- Fit: balcony keeps its storey (DECK_MAX was pinning it to the deck), a balcony without floor stands on
  the veranda under it, post bases (< 8 % high) are not piers.
- Results: `~/Téléchargements/generated-view/{lodge-stone-t73, mg-arcades, mg-varangue, mg-balcony, mg-earth}`
  (Malagasy photos in `resources/refine-3d/mg-*.jpg`, credits in `SOURCES-refine.md`).

## Decisions

- New parts optional: a plan without them builds byte for byte as PQ-T72 (`house-mesh.test.ts` hashes);
  bungalow and school readings replayed on old and new code → identical `house.json` and render.
- Specialists as structured-output tools (one call each), not a multi-turn tool loop: images sent once
  per call, parallel, each answer validated alone.
- No Neon migration (recipes not stored). No HF republish (bench unchanged).

## Open

- Timber knees read as `arcade: bracket` only; a stone arcade wears the wall / stone swatch.
- Dormers and bellcast eaves are still blocks; a structure specialist may list timber posts as piers.
- Meta network was flaky this session (socket hang up, header timeouts): a run can lose a view.
