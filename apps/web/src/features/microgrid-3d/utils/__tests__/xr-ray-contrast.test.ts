import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createSurroundingProbe,
  darkness,
  luminance,
  materialColorAt,
  RAY_CONTRAST,
  rayColors,
  surroundingLuminance,
} from '../xr-ray-contrast';
import { createRayVisual } from '../xr-ray-visual';
import { putOnInputLayer } from '../xr-inputs-shown';

const colors = () => ({
  core: new THREE.Color(),
  halo: new THREE.Color(),
  select: new THREE.Color(),
});
const wall = (color: string, z = -3) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color }));
  m.position.z = z;
  m.updateMatrixWorld(true);
  return m;
};
const O = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);

describe('adaptive laser colours (VS-T30)', () => {
  it('light laser on dark surroundings, dark laser on bright ones, smooth in between', () => {
    expect(darkness(0)).toBe(0);
    expect(darkness(1)).toBe(1);
    const mid = darkness((RAY_CONTRAST.swapFrom + RAY_CONTRAST.swapTo) / 2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('the halo is always the opposite tone of the core', () => {
    const light = colors();
    rayColors(0, light);
    expect(luminance(light.core)).toBeGreaterThan(0.9);
    expect(luminance(light.halo)).toBeLessThan(0.05);
    const dark = colors();
    rayColors(1, dark);
    expect(luminance(dark.core)).toBeLessThan(0.05);
    expect(luminance(dark.halo)).toBeGreaterThan(0.9);
  });

  it('reads the colour of the first surface the ray meets', () => {
    const scene = new THREE.Scene();
    scene.add(wall('#ffffff'));
    expect(darkness(surroundingLuminance(scene, O, FWD))).toBe(1);
    const night = new THREE.Scene();
    night.add(wall('#101418'));
    expect(darkness(surroundingLuminance(night, O, FWD))).toBe(0);
  });

  it('skips hidden objects, hand / controller models and the lasers themselves', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05070a');
    const hidden = wall('#ffffff', -1);
    hidden.visible = false;
    const hand = putOnInputLayer(wall('#ffffff', -1.5));
    const laser = createRayVisual();
    laser.group.visible = true;
    laser.group.add(wall('#ffffff', -2));
    scene.add(hidden, hand, laser.group);
    expect(darkness(surroundingLuminance(scene, O, FWD))).toBe(0);
  });

  it('falls back to the sky: plain background, then fog, then a bright default', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#ffffff');
    expect(surroundingLuminance(scene, O, FWD)).toBeCloseTo(1);
    const foggy = new THREE.Scene();
    foggy.fog = new THREE.Fog('#000000', 1, 10);
    expect(surroundingLuminance(foggy, O, FWD)).toBe(0);
    expect(surroundingLuminance(new THREE.Scene(), O, FWD)).toBe(RAY_CONTRAST.sky);
  });

  it('adds the emissive glow to the material colour', () => {
    const out = new THREE.Color();
    const mat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff' });
    expect(materialColorAt(mat, undefined, out)).toBe(true);
    expect(luminance(out)).toBeCloseTo(1);
    expect(materialColorAt(new THREE.ShadowMaterial(), undefined, out)).toBe(true);
    expect(materialColorAt(new THREE.MeshNormalMaterial(), undefined, out)).toBe(false);
  });

  it('the probe re-samples every few frames only', () => {
    const scene = new THREE.Scene();
    const w = wall('#ffffff');
    scene.add(w);
    const probe = createSurroundingProbe();
    expect(darkness(probe(0, scene, O, FWD))).toBe(1);
    (w.material as THREE.MeshBasicMaterial).color.set('#000000');
    expect(darkness(probe(0, scene, O, FWD))).toBe(1); // cached
    for (let i = 2; i < RAY_CONTRAST.everyFrames; i++) probe(0, scene, O, FWD);
    expect(darkness(probe(0, scene, O, FWD))).toBe(0);
  });

  it('the ray visual turns dark on a bright surrounding, with a light halo', () => {
    const v = createRayVisual();
    const frame = {
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 0, -1),
      end: new THREE.Vector3(0, 0, -2),
      usable: true,
      input: 'controller' as const,
      pressed: false,
      tint: '#ffffff',
      surrounding: 1,
      dt: 1,
    };
    v.update(frame);
    const mats: number[] = [];
    v.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && o !== v.group.children[1]?.children[1]) mats.push(luminance(m.color));
    });
    expect(Math.min(...mats)).toBeLessThan(0.05);
    expect(Math.max(...mats)).toBeGreaterThan(0.9);
    expect(v.group.userData.noRayProbe).toBe(true);
  });
});
