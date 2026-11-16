// three's WebXR hand and controller model factories, re-exported from plain JS: their own typings
// pull three's `src/` declarations next to `build/`, and the two `Object3D` types then clash across
// the whole project. `three-xr-factories.d.ts` types the few members we use.
export { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
export { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
