import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  attachInputModels,
  createHandSkinMaterial,
  HAND_SKIN,
  modelLoaded,
  replayConnected,
  skinHand,
} from '../xr-input-models';

describe('real XR input models', () => {
  it('skins every mesh of a loaded hand with one shared material', () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const b = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(a, new THREE.Group().add(b));
    const skin = createHandSkinMaterial();
    expect(skinHand(root, skin)).toBe(2);
    expect(a.material).toBe(skin);
    expect(b.material).toBe(skin);
    expect(skin.color.getHexString()).toBe(HAND_SKIN.slice(1));
  });

  it('adds a pale rim to the skin shader', () => {
    const shader = {
      uniforms: {},
      fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
      vertexShader: '',
    };
    createHandSkinMaterial().onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toContain('uniform vec3 rimColor');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += rimColor');
  });

  it('replays `connected` only for the input kind the space wants', () => {
    const space = new THREE.Group();
    const seen = vi.fn();
    space.addEventListener('connected' as never, seen);
    const hand = { hand: {} } as unknown as XRInputSource;
    const pad = { gamepad: {} } as unknown as XRInputSource;
    expect(replayConnected(space, hand, 'hand')).toBe(true);
    expect(replayConnected(space, pad, 'hand')).toBe(false);
    expect(replayConnected(space, pad, 'controller')).toBe(true);
    expect(replayConnected(space, undefined, 'controller')).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('adds a model to each space and removes it on dispose; nothing loaded yet', () => {
    const hand = new THREE.Group();
    const grip = new THREE.Group();
    const gl = { xr: { getSession: () => null } } as unknown as THREE.WebGLRenderer;
    const m = attachInputModels(gl, 0, { hand, grip });
    expect(hand.children).toHaveLength(1);
    expect(grip.children).toHaveLength(1);
    expect(m.handLoaded()).toBe(false);
    expect(m.gripLoaded()).toBe(false);
    m.dispose();
    expect(hand.children).toHaveLength(0);
    expect(grip.children).toHaveLength(0);
  });

  it('is loaded once the model has its mesh; the stand-in shows only until then (VS-T26)', () => {
    expect(modelLoaded(null)).toBe(false);
    const grip = new THREE.Group();
    const fallback = new THREE.Group();
    const gl = { xr: { getSession: () => null } } as unknown as THREE.WebGLRenderer;
    const m = attachInputModels(gl, 1, { grip, gripFallback: fallback });
    expect(m.gripLoaded()).toBe(false);
    expect(fallback.visible).toBe(true);
    // The factory adds the profile's scene under the model when it arrives.
    const model = grip.children[0]!;
    model.add(new THREE.Mesh());
    expect(modelLoaded(model)).toBe(true);
    expect(m.gripLoaded()).toBe(true);
    expect(fallback.visible).toBe(false);
    m.dispose();
  });
});
