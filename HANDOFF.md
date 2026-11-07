# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-07 · **By:** Antigravity · **Branch:** feat/realistic-clouds

## Current state

- Celestial 0° to 180° cycle: pure celestial mechanics for Sun (06h->18h) and Moon (18h->06h) with smooth arc progression.
- Night sky: 720 twinkling stars on upper dome (1 draw call, circular points shader, dusk/dawn smooth fade).
- Moon orb & halo: luminous silver disc with ethereal cyan glow arcing 0° (dusk) -> 90° (midnight) -> 180° (dawn).
- Dynamic lighting: directional key light tracks sun by day, moon by night for physically-grounded shadows.
- Cloud drift: enhanced peaceful continuous drift, organic floating breeze, and simulated time-of-day progression.
- Realistic cumulus: multi-lobed smooth spheres with wrapped diffuse, ambient bounce, rim backlight (1 InstancedMesh).
- Speed selector: timeline scrubber playback speed (0.25x to 4x) with full i18n (EN/FR/MG).
- All 47 3D test files (327 tests), 27 engine tests (353 tests), typecheck, and i18n parity check pass 100%.

## Next

1. Verify live visual experience at `http://localhost:3001/simulation`.
2. Ready to merge to main or create PR.

## Files touched

- Add: `microgrid-3d/utils/celestial.ts`, `microgrid-3d/utils/__tests__/celestial.test.ts`.
- Edit: `microgrid-3d/ui/sky-backdrop.tsx`, `microgrid-3d/ui/village-canvas.tsx`, `microgrid-3d/ui/weather-effects.tsx`, `HANDOFF.md`.

## Decisions

- Display altitude vs Key altitude: display altitude keeps celestial bodies nicely framed above mountains (2.5° to 7.5° in view), while key light altitude (6° to 42°) preserves crisp, readable shadows on ground.
- Night illumination: key light uses Moon position at night with silvery-blue tone, casting soft nocturnal village shadows.
