# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-09 · **By:** Antigravity · **Branch:** feat/vr-village-spatial-shoot

## Current state

- Complete WebXR immersion on `/village` (Village Studio / In-Air Detection & Shoot):
  - Fixed WebXR camera stream & backdrop visual:
    - Replaced 2D canvas bridge with zero-copy `THREE.VideoTexture` to eliminate 111 MB/s PCIe bus flooding.
    - Preloaded instant HD sample room texture (`/samples/vision-room.jpg`) from frame 0 so operator never sees a black screen.
    - Styled camera preview element with 0.85 opacity (exceeding Chromium's 0.05 power-saver threshold).
  - Fixed IWER emulator infinite crash loop (`TypeError: Cannot read properties of null (reading '0')` at `iwe.min.js:onDeviceFrame`):
    - Added `disableIWERFrameClear(session)` which sets `device.frameClearEnabled = false`, bypassing the bugged IWER clear block.
    - Auto-installed `installWebGLContextSafetyPolyfill()` globally at module boot with `clearColor` swallow and non-null fallbacks.
    - Wired `useContextLoss` to `VillageXRViewport` with epoch canvas remounting.
  - 100% key parity across `en.json`, `fr.json`, `mg.json` (`make check-i18n`).
  - 0 TypeScript errors (`tsc --noEmit`), 41/41 vision-insert tests pass, 60/60 microgrid-3d tests pass.

## Next

1. In the browser, reload the tab (`Ctrl+R` or `F5`) on `http://localhost:3001/village` to kill the previous unpatched RAF loop.
2. Review scenarios V196–V203 in `test-scenarios/06-village.md`.
3. VS-T9: 3D positional audio panner (`PannerNode` / `PositionalAudio`).

## Files touched

- `apps/web/src/features/microgrid-3d/utils/xr-session.ts`
- `apps/web/src/features/microgrid-3d/utils/webgl.ts`
- `apps/web/src/features/microgrid-3d/index.tsx`
- `apps/web/src/features/microgrid-3d/utils/__tests__/xr-session.test.ts`
- `apps/web/src/features/microgrid-3d/utils/__tests__/webgl.test.ts`
- `HANDOFF.md`
