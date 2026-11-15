import * as THREE from 'three';
import { TOKEN_HEX } from '@/features/microgrid-3d/utils/scene-palette';

/**
 * Futuristic hologram look of the /village VR extraction panels (VS-T18–T22): cyan light with
 * amber accents, moving scan lines, glowing corner brackets, additive glass. Cheap on Quest:
 * one plane per panel, procedural fragment shader (no texture), no post-processing (FFR stays on).
 */
export const HOLO = {
  cyan: TOKEN_HEX.energyCyan,
  amber: TOKEN_HEX.solarAmber,
  green: TOKEN_HEX.batteryGreen,
  red: TOKEN_HEX.criticalRed,
  violet: TOKEN_HEX.aiViolet,
  /** Panel ink: near-white cyan, readable on the dark glass. */
  ink: '#e6fbff',
  /** Glass behind the text (canvas textures), deep navy. */
  glass: 'rgba(4, 18, 32, 0.82)',
  /** 3D lab room: dome, dim grid lines, pedestal. */
  dome: '#030b18',
  gridDim: '#0b3a4a',
  pedestal: '#0b1a2b',
} as const;

const FRAME_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Frame: translucent glass, bright border, corner brackets, scan lines drifting up, a soft
 * flicker. `uHover` brightens it, `uActive` adds the sweep band (work in progress).
 */
const FRAME_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uHover;
uniform float uActive;
uniform float uOpacity;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vec2 p = vUv * uSize;
  float dx = min(p.x, uSize.x - p.x);
  float dy = min(p.y, uSize.y - p.y);
  float edge = min(dx, dy);
  float border = 1.0 - smoothstep(0.0025, 0.006, edge);
  float bracketLen = min(uSize.x, uSize.y) * 0.18;
  float corner = step(dx, bracketLen) * step(dy, bracketLen);
  float bracket = corner * (1.0 - smoothstep(0.006, 0.011, edge));
  float scan = 0.5 + 0.5 * sin((p.y * 260.0) - uTime * 6.0);
  float flicker = 0.94 + 0.06 * sin(uTime * 37.0) * sin(uTime * 11.0);
  float sweepPos = fract(uTime * 0.45) * uSize.y;
  float sweep = uActive * (1.0 - smoothstep(0.0, 0.05, abs(p.y - sweepPos)));
  float glass = 0.10 + 0.05 * scan + 0.10 * uHover;
  float a = (glass + border * (0.7 + 0.3 * uHover) + bracket * 0.9 + sweep * 0.6) * flicker;
  gl_FragColor = vec4(uColor * (1.0 + 0.6 * uHover + bracket * 0.8), a * uOpacity);
}
`;

export interface HoloFrameMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uColor: { value: THREE.Color };
    uTime: { value: number };
    uHover: { value: number };
    uActive: { value: number };
    uOpacity: { value: number };
    uSize: { value: THREE.Vector2 };
  };
}

/** Frame material for a `width` × `height` m plane. Caller disposes it. */
export function createHoloFrameMaterial(
  width: number,
  height: number,
  color: string = HOLO.cyan
): HoloFrameMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FRAME_VERTEX,
    fragmentShader: FRAME_FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uHover: { value: 0 },
      uActive: { value: 0 },
      uOpacity: { value: 1 },
      uSize: { value: new THREE.Vector2(width, height) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  }) as HoloFrameMaterial;
}

/**
 * Drawn view (2D face) shown as a hologram: the drawing stays true to colour (it is validated
 * here), with faint scan lines, a cyan rim and a dim when it is not the slide in focus.
 */
const IMAGE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uFocus;
uniform float uOpacity;
uniform vec3 uRim;
varying vec2 vUv;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float scan = 0.96 + 0.04 * sin(vUv.y * 420.0 - uTime * 5.0);
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float rim = 1.0 - smoothstep(0.0, 0.03, edge);
  vec3 col = mix(tex.rgb * scan, uRim, rim * 0.65);
  col *= mix(0.45, 1.0, uFocus);
  gl_FragColor = vec4(col, uOpacity * mix(0.55, 1.0, uFocus));
}
`;

export interface HoloImageMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uMap: { value: THREE.Texture | null };
    uTime: { value: number };
    uFocus: { value: number };
    uOpacity: { value: number };
    uRim: { value: THREE.Color };
  };
}

export function createHoloImageMaterial(map: THREE.Texture | null): HoloImageMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FRAME_VERTEX,
    fragmentShader: IMAGE_FRAGMENT,
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
      uFocus: { value: 1 },
      uOpacity: { value: 1 },
      uRim: { value: new THREE.Color(HOLO.cyan) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }) as HoloImageMaterial;
}

/** One line of a holographic card. */
export interface HoloLine {
  text: string;
  /** Pixel size on the 1024-wide canvas; default 44. */
  size?: number;
  color?: string;
  weight?: 400 | 600 | 700;
}

export interface HoloCardSpec {
  lines: HoloLine[];
  /** Canvas size in px (keep the aspect of the plane it goes on). */
  width?: number;
  height?: number;
  align?: 'left' | 'center';
  /** Glass behind the text; false = text only (on a frame). */
  glass?: boolean;
  accent?: string;
}

/** Wraps `text` to `maxWidth` px, at most `maxLines` lines (last one with an ellipsis). */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

export const holoFont = (size: number, weight: HoloLine['weight']) =>
  `${weight ?? 600} ${size}px "Inter", "Segoe UI", system-ui, sans-serif`;

const LINE_HEIGHT = 1.22;

export interface HoloCardBlock {
  line: HoloLine;
  size: number;
  font: string;
  rows: string[];
}

/**
 * Lays the lines out on a `w`×`h` canvas: each wraps to at most 2 rows, and when the stack is
 * taller than the card every size shrinks together until it fits (a long object name used to push
 * the title's first row off the top of the card). `measure` gives a string's width in a font.
 */
export function layoutHoloCard(
  measure: (font: string, s: string) => number,
  lines: HoloLine[],
  w: number,
  h: number
): { blocks: HoloCardBlock[]; total: number } {
  const pad = w * 0.05;
  const room = h * 0.94;
  let scale = 1;
  for (;;) {
    const blocks = lines.map((line) => {
      const size = Math.max(8, Math.round((line.size ?? 44) * scale));
      const font = holoFont(size, line.weight);
      return {
        line,
        size,
        font,
        rows: wrapText((s) => measure(font, s), line.text, w - 2 * pad, 2),
      };
    });
    const total = blocks.reduce((acc, b) => acc + b.rows.length * b.size * LINE_HEIGHT, 0);
    if (total <= room || scale <= 0.3) return { blocks, total };
    scale *= Math.max(0.6, Math.min(0.95, room / total));
  }
}

const cardCache = new Map<string, THREE.CanvasTexture>();
const CARD_CACHE_MAX = 96;

/**
 * Canvas texture of a holographic text card (cached by content; redrawn only on change, never per
 * frame). Each line wraps to at most 2 lines, all shrunk together to fit. Glass + thin rim + corner ticks when `glass`.
 */
export function holoCardTexture(spec: HoloCardSpec): THREE.CanvasTexture {
  const key = JSON.stringify(spec);
  const cached = cardCache.get(key);
  if (cached) return cached;
  const w = spec.width ?? 1024;
  const h = spec.height ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const accent = spec.accent ?? HOLO.cyan;
  if (ctx) {
    if (spec.glass !== false) {
      ctx.fillStyle = HOLO.glass;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 8;
      const t = Math.min(w, h) * 0.16;
      for (const [x, y, sx, sy] of [
        [4, 4, 1, 1],
        [w - 4, 4, -1, 1],
        [4, h - 4, 1, -1],
        [w - 4, h - 4, -1, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(x + sx * t, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * t);
        ctx.stroke();
      }
    }
    const pad = w * 0.05;
    const { blocks, total } = layoutHoloCard(
      (font, s) => {
        ctx.font = font;
        return ctx.measureText(s).width;
      },
      spec.lines,
      w,
      h
    );
    let y = (h - total) / 2;
    ctx.textBaseline = 'top';
    ctx.textAlign = spec.align === 'left' ? 'left' : 'center';
    const x = spec.align === 'left' ? pad : w / 2;
    for (const b of blocks) {
      ctx.font = b.font;
      ctx.fillStyle = b.line.color ?? HOLO.ink;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 14;
      for (const row of b.rows) {
        ctx.fillText(row, x, y);
        y += b.size * LINE_HEIGHT;
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (cardCache.size >= CARD_CACHE_MAX) {
    const oldest = cardCache.keys().next().value;
    if (oldest !== undefined) {
      cardCache.get(oldest)?.dispose();
      cardCache.delete(oldest);
    }
  }
  cardCache.set(key, texture);
  return texture;
}
