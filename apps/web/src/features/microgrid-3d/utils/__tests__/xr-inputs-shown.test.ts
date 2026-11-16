import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyInputLayer,
  putOnInputLayer,
  useXrInputsShown,
  XR_INPUT_LAYER,
  XR_NEAR,
  xrNear,
} from '../xr-inputs-shown';
import { createControllerGripModel, createHandMesh } from '../xr-hands';

describe('hands & controllers shown or hidden (VS-T30)', () => {
  beforeEach(() => useXrInputsShown.getState().setShown(true));

  it('hand and controller stand-ins live on their own layer only', () => {
    const grip = createControllerGripModel();
    grip.traverse((o) => expect(o.layers.mask).toBe(1 << XR_INPUT_LAYER));
    expect(createHandMesh().layers.mask).toBe(1 << XR_INPUT_LAYER);
  });

  it('the camera layer switch shows or hides them, the scene stays', () => {
    const camera = new THREE.PerspectiveCamera();
    const hand = putOnInputLayer(new THREE.Mesh());
    const house = new THREE.Mesh();
    applyInputLayer(camera, true);
    expect(hand.layers.test(camera.layers)).toBe(true);
    applyInputLayer(camera, false);
    expect(hand.layers.test(camera.layers)).toBe(false);
    expect(house.layers.test(camera.layers)).toBe(true);
  });

  it('the choice toggles and is kept for the next visit', () => {
    useXrInputsShown.getState().toggle();
    expect(useXrInputsShown.getState().shown).toBe(false);
    expect(localStorage.getItem('mitsinjo.xr.inputsShown')).toBe('false');
    useXrInputsShown.getState().toggle();
    expect(useXrInputsShown.getState().shown).toBe(true);
  });

  it('pulls the near plane in for VR so hands ~0.4 m away are not clipped (/simulation 0.5 m)', () => {
    expect(xrNear(0.5)).toBe(XR_NEAR);
    expect(xrNear(0.5)).toBeLessThan(0.3);
    expect(xrNear(0.01)).toBe(0.01);
  });
});
