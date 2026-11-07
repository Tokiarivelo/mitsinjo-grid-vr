'use client';

import * as THREE from 'three';

/**
 * Tiny canvas textures generated once on the client (no image downloads):
 * corrugated metal, PV cell grid, striped market canvas, laterite grain, paddy field.
 * Cached per key. Speckle uses a seeded PRNG so screenshots stay deterministic.
 */
const cache = new Map<string, THREE.Texture>();

/** Deterministic PRNG (mulberry32): same seed → same texture, every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(
  key: string,
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
  srgb = true
) {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Corrugated sheet: grayscale ridges, used as color multiplier and bump map. u = along eave. */
export function corrugatedTexture(): THREE.Texture {
  return make('corrugated', 64, 8, (g) => {
    for (let x = 0; x < 64; x++) {
      const v = 0.72 + 0.28 * Math.sin((x / 64) * Math.PI * 2 * 8);
      const c = Math.round(v * 255);
      g.fillStyle = `rgb(${c},${c},${c})`;
      g.fillRect(x, 0, 1, 8);
    }
  });
}

/** PV module: dark blue cells with thin silver bus lines and a light frame. */
export function solarCellTexture(): THREE.Texture {
  return make('pv', 128, 64, (g) => {
    g.fillStyle = '#c9d3e0';
    g.fillRect(0, 0, 128, 64);
    const cols = 12;
    const rows = 6;
    const cw = 128 / cols;
    const ch = 64 / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const shade = 30 + ((i * 7 + j * 13) % 9);
        g.fillStyle = `rgb(${shade - 10},${shade + 20},${shade + 85})`;
        g.fillRect(i * cw + 0.8, j * ch + 0.8, cw - 1.6, ch - 1.6);
      }
    }
  });
}

/** Striped awning canvas (two colors). */
export function stripeTexture(a: string, b: string): THREE.Texture {
  return make(`stripe-${a}-${b}`, 32, 4, (g) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 === 0 ? a : b;
      g.fillRect(i * 8, 0, 8, 4);
    }
  });
}

/**
 * Laterite grain (M12-T1): near-white detail map that multiplies the vertex-colored ground —
 * the palette survives, the soil gets pebbles and dry flecks. Look target: generated laterite.
 */
export function redEarthTexture(): THREE.Texture {
  return make('red-earth', 128, 128, (g) => {
    const rand = mulberry32(0x1a71e);
    g.fillStyle = '#f5efe7';
    g.fillRect(0, 0, 128, 128);
    const dots: [string, number][] = [
      ['#d9c2ac', 520],
      ['#c39a7c', 220],
      ['#8a5a3a', 40],
      ['#ffffff', 120],
    ];
    for (const [color, n] of dots) {
      g.fillStyle = color;
      for (let i = 0; i < n; i++) {
        g.fillRect(Math.floor(rand() * 128), Math.floor(rand() * 128), 1, 1);
      }
    }
    // Dry grass flecks: short pale strokes.
    g.strokeStyle = '#e3d3ae';
    g.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const x = rand() * 128;
      const y = rand() * 128;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 5, y + (rand() - 0.5) * 5);
      g.stroke();
    }
  });
}

/**
 * Rice paddy (M12-T1): one 4×4-bund parcel that tiles seamlessly (bunds on the grid lines).
 * Look target: generated flooded paddy — muddy water, earth bunds, seedling dots.
 */
export function paddyTexture(): THREE.Texture {
  return make('paddy', 128, 128, (g) => {
    const rand = mulberry32(0x9a11ce);
    g.fillStyle = '#77855f';
    g.fillRect(0, 0, 128, 128);
    // Water glints.
    g.fillStyle = '#cfd8c4';
    for (let i = 0; i < 40; i++) {
      g.fillRect(Math.floor(rand() * 128), Math.floor(rand() * 128), 1, 1);
    }
    // Seedling dots, 3×3 per cell with jitter (never on the bunds).
    g.fillStyle = '#3f7a2e';
    for (let cx = 0; cx < 4; cx++) {
      for (let cy = 0; cy < 4; cy++) {
        for (let ix = 0; ix < 3; ix++) {
          for (let iy = 0; iy < 3; iy++) {
            const x = cx * 32 + 7 + ix * 8 + Math.floor((rand() - 0.5) * 3);
            const y = cy * 32 + 7 + iy * 8 + Math.floor((rand() - 0.5) * 3);
            g.fillRect(x, y, 2, 2);
          }
        }
      }
    }
    // Earth bunds on the grid lines (tile edges included → seamless).
    g.fillStyle = '#8a6f4d';
    for (let k = 0; k < 4; k++) {
      g.fillRect(k * 32, 0, 3, 128);
      g.fillRect(0, k * 32, 128, 3);
    }
  });
}

/** Leaf vein pattern for natural foliage relief. */
export function leafVeinTexture(): THREE.Texture {
  return make('leaf-vein', 64, 64, (g) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 64, 64);
    // Central midrib
    g.strokeStyle = '#a0a0a0';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(32, 0);
    g.lineTo(32, 64);
    g.stroke();
    // Angled lateral veins
    g.strokeStyle = '#909090';
    g.lineWidth = 1;
    for (let y = 4; y < 64; y += 8) {
      g.beginPath();
      g.moveTo(32, y);
      g.lineTo(0, y + 12);
      g.moveTo(32, y);
      g.lineTo(64, y + 12);
      g.stroke();
    }
  });
}
