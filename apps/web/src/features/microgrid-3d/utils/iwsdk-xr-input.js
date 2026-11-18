// IWSDK input (IW-T1) through a plain JS re-export: its typings pull `@pmndrs/pointer-events`,
// which augments three's `Object3D` (pointer capture) and breaks every `Object3D` type in the
// project. `iwsdk-xr-input.d.ts` types the few members we use.
export { XRInputManager } from '@iwsdk/xr-input';
