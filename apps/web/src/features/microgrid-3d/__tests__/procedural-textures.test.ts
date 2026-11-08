import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  corrugatedTexture,
  horizontalTimberSlatTexture,
  mulberry32,
  paddyTexture,
  redEarthTexture,
} from '../ui/procedural-textures';
import { PADDY_CENTER, PADDY_SIZE, isBlocked } from '../utils/landscape';

describe('procedural textures (M12-T1)', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seq);
    expect(mulberry32(7)()).not.toBe(mulberry32(8)());
  });

  it('each texture is cached, repeat-wrapped and sRGB', () => {
    for (const make of [
      corrugatedTexture,
      redEarthTexture,
      paddyTexture,
      horizontalTimberSlatTexture,
    ]) {
      const tex = make();
      expect(make()).toBe(tex);
      expect(tex.wrapS).toBe(THREE.RepeatWrapping);
      expect(tex.wrapT).toBe(THREE.RepeatWrapping);
      expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    }
    expect(redEarthTexture()).not.toBe(paddyTexture());
  });

  it('new textures are 128×128 canvas tiles', () => {
    for (const tex of [redEarthTexture(), paddyTexture()]) {
      const img = tex.image as HTMLCanvasElement;
      expect(img.width).toBe(128);
      expect(img.height).toBe(128);
    }
  });
});

describe('paddy parcel (M12-T1)', () => {
  it('sits on free ground: center and corners unblocked', () => {
    const [cx, cz] = PADDY_CENTER;
    const [w, d] = PADDY_SIZE;
    const points: [number, number][] = [
      [cx, cz],
      [cx - w / 2, cz - d / 2],
      [cx + w / 2, cz - d / 2],
      [cx - w / 2, cz + d / 2],
      [cx + w / 2, cz + d / 2],
    ];
    for (const [x, z] of points) {
      expect(isBlocked(x, z, 0.3), `paddy point (${x}, ${z}) blocked`).toBe(false);
    }
  });
});
