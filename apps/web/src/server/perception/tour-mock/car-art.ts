/**
 * Imagined drawings of a tour car (VS-T44): every face of one parametric car, drawn as an exact
 * orthographic view (no Meta call, no photo on the model). The look aims at a game / animated-film
 * render: lacquered paint reflecting the sky above its shoulder line and the ground below it, a
 * specular streak along the body, tinted glass with reflections, alloy wheels, lamps with their
 * lenses. Same framing as the drawings `make views-3d` reads for a vehicle: the profile with the
 * nose on the right, the front, the back, the view from above with the nose at the bottom, each
 * on a light blue paper. Pure: SVG strings, rasterised by the caller.
 */

export type CarArtView = 'right' | 'front' | 'back' | 'top';

export interface CarArt {
  /** A hatchback, an estate and an MPV share an upright tail; a sedan has a boot deck. */
  kind: 'hatchback' | 'estate' | 'mpv' | 'sedan';
  /** Length, width (body, no mirrors), height (metres). */
  L: number;
  W: number;
  H: number;
  paint: string;
  /** Tyre radius and axle positions from the tail (metres). */
  wheelR: number;
  axles: readonly [rear: number, front: number];
  /** Beltline (bottom of the side windows) and bonnet height at the cowl (metres). */
  belt: number;
  /** Windscreen base and top, from the nose (metres). */
  cowl: number;
  roofFront: number;
  /** Where the roof ends from the tail, and how high the tail deck / hatch lip stands (metres). */
  roofRear: number;
  deck: number;
  /** Tail lamps: tall ones up the hatch sides, or wide ones across the boot. */
  lamps: 'tall' | 'wide';
  /** Lower bumpers and sills in black plastic instead of the paint. */
  blackTrim?: boolean;
  rim?: string;
  /** Roof rails along both roof edges. */
  rails?: boolean;
  /** Chrome trim round the side windows. */
  chrome?: boolean;
}

export const CAR_ART_PAPER = '#bfe0f4';
/** Canvas size of each view (pixels), as the drawings of `resources/refine-3d/c-*`. */
export const CAR_ART_SIZE: Record<CarArtView, readonly [number, number]> = {
  right: [2240, 1120],
  front: [1920, 1280],
  back: [1920, 1280],
  top: [1120, 2240],
};

// ------------------------------------------------------------------ colour

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (c: number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
/** `a` toward `b` by `t` (0–1). */
export const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgbOf(a), rgbOf(b)];
  return hexOf(x.map((v, i) => v + (y[i]! - v) * t));
};
const light = (c: string, t: number) => mix(c, '#ffffff', t);
const dark = (c: string, t: number) => mix(c, '#000000', t);

const n = (v: number) => +v.toFixed(4);

/** Shared gradients and patterns of every view. */
function defs(a: CarArt, ground: number, top: number): string {
  const p = a.paint;
  const rim = a.rim ?? '#c9ccd0';
  // A dark paint reflects the sky less brightly (a black car stays black on its shoulders).
  const [pr, pg, pb] = rgbOf(p);
  const k = (0.2126 * pr! + 0.7152 * pg! + 0.0722 * pb!) / 255 < 0.3 ? 0.4 : 1;
  const sky = (t: number) => light(p, t * k);
  // Paint seen from the side: sky above the shoulder (bright, a hard horizon line just below it),
  // the ground below (darker), a dim band at the very bottom.
  const span = top - ground;
  const at = (y: number) => n((top - y) / span);
  const shoulder = a.belt - 0.12;
  return `<defs>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.025"/></filter>
  <linearGradient id="paint" gradientUnits="userSpaceOnUse" x1="0" y1="${n(-top)}" x2="0" y2="${n(-ground)}">
    <stop offset="0" stop-color="${sky(0.28)}"/>
    <stop offset="${at(a.belt + 0.05)}" stop-color="${sky(0.42)}"/>
    <stop offset="${at(shoulder + 0.02)}" stop-color="${sky(0.6)}"/>
    <stop offset="${at(shoulder)}" stop-color="${dark(p, 0.18)}"/>
    <stop offset="${at(shoulder - 0.12)}" stop-color="${p}"/>
    <stop offset="${at(0.45)}" stop-color="${dark(p, 0.08)}"/>
    <stop offset="1" stop-color="${dark(p, 0.45)}"/>
  </linearGradient>
  <linearGradient id="hood" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${light(p, 0.55)}"/>
    <stop offset="1" stop-color="${light(p, 0.15)}"/>
  </linearGradient>
  <linearGradient id="roof" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${dark(p, 0.12)}"/>
    <stop offset="0.25" stop-color="${light(p, 0.25)}"/>
    <stop offset="0.5" stop-color="${light(p, 0.45)}"/>
    <stop offset="0.75" stop-color="${light(p, 0.25)}"/>
    <stop offset="1" stop-color="${dark(p, 0.12)}"/>
  </linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6f8796"/>
    <stop offset="0.45" stop-color="#34444f"/>
    <stop offset="1" stop-color="#151b20"/>
  </linearGradient>
  <linearGradient id="glassTop" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#8fb0c4"/>
    <stop offset="0.6" stop-color="#3a4d5a"/>
    <stop offset="1" stop-color="#1b232a"/>
  </linearGradient>
  <radialGradient id="tyre">
    <stop offset="0.6" stop-color="#2a2b2d"/>
    <stop offset="0.9" stop-color="#18191a"/>
    <stop offset="1" stop-color="#0b0b0c"/>
  </radialGradient>
  <radialGradient id="rim" cx="0.42" cy="0.38" r="0.7">
    <stop offset="0" stop-color="${light(rim, 0.7)}"/>
    <stop offset="0.55" stop-color="${rim}"/>
    <stop offset="1" stop-color="${dark(rim, 0.45)}"/>
  </radialGradient>
  <linearGradient id="tyreSide" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#0d0d0e"/>
    <stop offset="0.5" stop-color="#2b2c2e"/>
    <stop offset="1" stop-color="#0d0d0e"/>
  </linearGradient>
  <linearGradient id="lampRed" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ff6a5c"/>
    <stop offset="0.35" stop-color="#d4141c"/>
    <stop offset="1" stop-color="#6b0a0e"/>
  </linearGradient>
  <linearGradient id="lampClear" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/>
    <stop offset="0.5" stop-color="#dfe6ea"/>
    <stop offset="1" stop-color="#8d979e"/>
  </linearGradient>
  <linearGradient id="trim" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2f3134"/>
    <stop offset="1" stop-color="#121314"/>
  </linearGradient>
  <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
    <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.85"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
</defs>`;
}

let paper = CAR_ART_PAPER;
const svg = (w: number, h: number, box: [number, number, number, number], body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${box.map(n).join(' ')}" preserveAspectRatio="xMidYMid meet">
<rect x="${n(box[0])}" y="${n(box[1])}" width="${n(box[2])}" height="${n(box[3])}" fill="${paper}"/>
${body}
</svg>`;

/** Fit a [x0, y0, x1, y1] drawing (y up, metres) on a canvas with a margin; y is drawn as −y. */
function frame(view: CarArtView, x0: number, y0: number, x1: number, y1: number) {
  const [w, h] = CAR_ART_SIZE[view];
  const m = 0.06;
  const bw = (x1 - x0) * (1 + 2 * m);
  const bh = (y1 - y0) * (1 + 2 * m);
  const s = Math.max(bw / w, bh / h);
  const [vw, vh] = [w * s, h * s];
  const cx = (x0 + x1) / 2;
  const cy = -(y0 + y1) / 2;
  return { w, h, box: [cx - vw / 2, cy - vh / 2, vw, vh] as [number, number, number, number] };
}

const P = (pts: ReadonlyArray<readonly [number, number]>) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(-y)}`).join(' ') + ' Z';

/** An alloy wheel seen side-on: tyre, sidewall, five spokes over a dark disc, hub. */
function wheelSide(cx: number, r: number): string {
  const cy = -r;
  const ri = r * 0.64;
  const spokes = Array.from({ length: 5 }, (_, i) => {
    const t = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const a0 = t + 0.2;
    const a1 = t + (Math.PI * 2) / 5 - 0.2;
    const [r0, r1] = [ri * 0.3, ri * 0.92];
    const pt = (rr: number, a: number) => `${n(cx + rr * Math.cos(a))} ${n(cy + rr * Math.sin(a))}`;
    return `<path d="M${pt(r0, a0)} L${pt(r1, a0)} A${n(r1)} ${n(r1)} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} Z" fill="#1a1c1f"/>`;
  }).join('');
  const sw = r * 0.012;
  return `<g>
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#tyre)"/>
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.8)}" fill="none" stroke="#3a3b3e" stroke-width="${n(r * 0.03)}"/>
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ri)}" fill="url(#rim)"/>
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ri * 0.82)}" fill="#3b3f44"/>
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ri * 0.62)}" fill="#55595e"/>
  <rect x="${n(cx + ri * 0.38)}" y="${n(cy - ri * 0.62)}" width="${n(ri * 0.26)}" height="${n(ri * 0.62)}" rx="${n(ri * 0.1)}" fill="#7b8086" transform="rotate(-25 ${n(cx)} ${n(cy)})"/>
  ${spokes}
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ri)}" fill="none" stroke="${light('#c9ccd0', 0.5)}" stroke-width="${n(sw * 2)}"/>
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ri * 0.28)}" fill="url(#rim)" stroke="#6d7277" stroke-width="${n(sw)}"/>
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ri * 0.1)}" fill="#2a2d31"/>
</g>`;
}

// ------------------------------------------------------------------ profile

/** The body's side outline (tail at x = 0, nose at x = L), arches cut out, y up. */
function sideOutline(a: CarArt): string {
  const { L, H, wheelR: r, belt, cowl, roofFront, roofRear, deck } = a;
  const sill = r * 0.82;
  const R = r + 0.06;
  const arch = (cx: number) => {
    const dx = Math.sqrt(Math.max(0, R * R - (sill - r) ** 2));
    return { x0: cx + dx, x1: cx - dx };
  };
  const [rw, fw] = [arch(a.axles[0]), arch(a.axles[1])];
  const Y = (y: number) => n(-y);
  const hatch = a.kind !== 'sedan';
  const tailTop = hatch ? belt + 0.04 : deck;
  const d = [
    `M${n(0.12)} ${Y(sill + 0.04)}`,
    `C${n(0.02)} ${Y(sill + 0.06)} ${n(0)} ${Y(0.42)} ${n(0.005)} ${Y(0.55)}`,
    `C${n(0.01)} ${Y(0.7)} ${n(0.02)} ${Y(tailTop - 0.08)} ${n(0.045)} ${Y(tailTop)}`,
    hatch
      ? `C${n(0.09)} ${Y(H - 0.3)} ${n(roofRear * 0.45)} ${Y(H - 0.06)} ${n(roofRear)} ${Y(H - 0.035)}`
      : `L${n(0.3)} ${Y(deck + 0.03)} C${n(roofRear * 0.7)} ${Y(deck + 0.05)} ${n(roofRear * 0.85)} ${Y(belt + 0.1)} ${n(roofRear)} ${Y(H - 0.03)}`,
    `C${n(roofRear + (L - roofFront - roofRear) * 0.3)} ${Y(H + 0.05)} ${n(L - roofFront - 0.35)} ${Y(H + 0.03)} ${n(L - roofFront)} ${Y(H - 0.045)}`,
    `C${n(L - roofFront + 0.25)} ${Y(H - 0.12)} ${n(L - cowl - 0.18)} ${Y(belt + 0.12)} ${n(L - cowl)} ${Y(belt + 0.02)}`,
    `C${n(L - cowl * 0.55)} ${Y(belt - 0.07)} ${n(L - 0.22)} ${Y(belt - 0.17)} ${n(L - 0.06)} ${Y(belt - 0.26)}`,
    `C${n(L + 0.01)} ${Y(belt - 0.32)} ${n(L + 0.005)} ${Y(0.48)} ${n(L - 0.01)} ${Y(0.4)}`,
    `C${n(L - 0.02)} ${Y(sill + 0.06)} ${n(L - 0.06)} ${Y(sill + 0.02)} ${n(L - 0.16)} ${Y(sill)}`,
    `L${n(fw.x0)} ${Y(sill)}`,
    `A${n(R)} ${n(R)} 0 1 0 ${n(fw.x1)} ${Y(sill)}`,
    `L${n(rw.x0)} ${Y(sill)}`,
    `A${n(R)} ${n(R)} 0 1 0 ${n(rw.x1)} ${Y(sill)}`,
    'Z',
  ];
  return d.join(' ');
}

function rightView(a: CarArt): string {
  const { L, H, wheelR: r, belt, cowl, roofFront } = a;
  const f = frame('right', -0.05, 0, L + 0.05, H + 0.05);
  const hatch = a.kind !== 'sedan';
  const sw = 0.006;
  const outline = sideOutline(a);
  // Side glass: from the C pillar to the A pillar, under the roof.
  const gx0 = hatch ? a.roofRear * 0.55 + 0.08 : a.roofRear + 0.12;
  const gx1 = L - cowl - 0.12;
  const gTop = H - 0.07;
  // A wedge: the window line rises toward the back.
  const glass: Array<[number, number]> = [
    [gx0, belt + 0.13],
    [hatch ? a.roofRear + 0.04 : gx0 + 0.22, gTop - 0.03],
    [L - roofFront - 0.02, gTop],
    [gx1, belt + 0.05],
  ];
  const bx = gx0 + (gx1 - gx0) * 0.52; // B pillar
  const cx = gx0 + (gx1 - gx0) * 0.2; // C pillar / quarter window
  const doors = [
    `M${n(bx + 0.02)} ${n(-(belt + 0.06))} L${n(bx + 0.05)} ${n(-(r * 0.85))}`,
    `M${n(gx1 + 0.02)} ${n(-(belt + 0.05))} C${n(gx1 + 0.12)} ${n(-(belt - 0.2))} ${n(gx1 + 0.1)} ${n(-(r * 1.4))} ${n(gx1 + 0.04)} ${n(-(r * 0.85))}`,
    `M${n(cx + 0.04)} ${n(-(belt + 0.06))} C${n(cx + 0.14)} ${n(-(belt - 0.25))} ${n(a.axles[0] + r + 0.12)} ${n(-(r * 1.3))} ${n(a.axles[0] + r + 0.1)} ${n(-(r * 0.85))}`,
  ];
  const handle = (x: number) =>
    `<rect x="${n(x)}" y="${n(-(belt - 0.07))}" width="0.13" height="0.028" rx="0.012" fill="${dark(a.paint, 0.35)}"/><rect x="${n(x + 0.01)}" y="${n(-(belt - 0.072))}" width="0.11" height="0.008" rx="0.004" fill="${light(a.paint, 0.6)}"/>`;
  const mirrorX = gx1 - 0.08;
  const lampTail =
    a.lamps === 'tall'
      ? P([
          [0.02, belt - 0.12],
          [0.06, belt + 0.2],
          [0.12, belt + 0.3],
          [0.2, belt + 0.18],
          [0.17, belt - 0.02],
          [0.09, belt - 0.18],
        ])
      : P([
          [0.01, belt - 0.12],
          [0.03, belt + 0.02],
          [0.32, belt + 0.03],
          [0.3, belt - 0.08],
        ]);
  const lampHead = P([
    [L - 0.04, belt - 0.27],
    [L - 0.3, belt - 0.13],
    [L - 0.48, belt - 0.07],
    [L - 0.46, belt - 0.13],
    [L - 0.32, belt - 0.24],
    [L - 0.12, belt - 0.36],
  ]);
  const trimFill = a.blackTrim ? 'url(#trim)' : dark(a.paint, 0.25);
  const body = `
${defs(a, 0, H)}
<clipPath id="bodyClip"><path d="${outline}"/></clipPath>
${[a.axles[0], a.axles[1]].map((x) => `<circle cx="${n(x)}" cy="${n(-r)}" r="${n(r + 0.06)}" fill="#0b0c0d" clip-path="url(#aboveSill)"/>`).join('')}
<clipPath id="aboveSill"><rect x="-1" y="${n(-H - 1)}" width="${n(L + 2)}" height="${n(H + 1 - r * 0.8)}"/></clipPath>
<path d="${outline}" fill="url(#paint)" stroke="#1d1f22" stroke-width="${sw}"/>
<g clip-path="url(#bodyClip)">
  <ellipse cx="${n(L * 0.45)}" cy="${n(-(belt - 0.32))}" rx="${n(L * 0.32)}" ry="0.09" fill="#ffffff" opacity="0.16" filter="url(#soft)"/>
  <ellipse cx="${n(L * 0.5)}" cy="${n(-(r * 0.95))}" rx="${n(L * 0.45)}" ry="0.07" fill="#000000" opacity="0.18" filter="url(#soft)"/>
  <path d="${outline}" fill="none" stroke="#000000" stroke-opacity="0.3" stroke-width="0.11" filter="url(#soft)"/>
  <rect x="-1" y="${n(-(r * 0.82 + 0.1))}" width="${n(L + 2)}" height="0.12" fill="${trimFill}" opacity="${a.blackTrim ? 1 : 0.55}"/>
  <path d="M-0.1 ${n(-(belt - 0.13))} L${n(L + 0.1)} ${n(-(belt - 0.19))}" stroke="url(#shine)" stroke-width="0.018" opacity="0.9"/>
  <path d="M0.2 ${n(-(belt + 0.01))} L${n(L - cowl)} ${n(-(belt + 0.01))}" stroke="${light(a.paint, 0.75)}" stroke-width="0.008" opacity="0.8"/>
  ${doors.map((d) => `<path d="${d}" fill="none" stroke="${dark(a.paint, 0.45)}" stroke-width="${sw}"/>`).join('')}
  ${handle(bx - 0.28)}${handle(gx1 - 0.3)}
  ${[a.axles[0], a.axles[1]].map((x) => `<path d="M${n(x - r - 0.1)} ${n(-(r * 0.82))} A${n(r + 0.1)} ${n(r + 0.1)} 0 0 1 ${n(x + r + 0.1)} ${n(-(r * 0.82))}" fill="none" stroke="${light(a.paint, 0.55)}" stroke-width="0.012" opacity="0.7"/>`).join('')}
  <path d="${lampTail}" fill="url(#lampRed)" stroke="#3a0608" stroke-width="${sw}"/>
  <path d="${lampHead}" fill="url(#lampClear)" stroke="#2c3034" stroke-width="${sw}"/>
  <circle cx="${n(L - 0.2)}" cy="${n(-(belt - 0.22))}" r="0.035" fill="#f1f4f6" opacity="0.9"/>
  <rect x="${n(L - 0.2)}" y="${n(-(r * 1.25))}" width="0.15" height="0.05" rx="0.02" fill="#1a1c1f"/>
  <rect x="${n(0.02)}" y="${n(-(r * 1.35))}" width="0.06" height="0.03" rx="0.01" fill="#8a1218"/>
</g>
<path d="${P(glass)}" fill="url(#glass)" stroke="${a.chrome ? '#dfe3e6' : '#121417'}" stroke-width="0.02" stroke-linejoin="round"/>
<clipPath id="glassClip"><path d="${P(glass)}"/></clipPath>
<g clip-path="url(#glassClip)" opacity="0.55">
  ${[bx - 0.38, bx + 0.42].map((x) => `<rect x="${n(x)}" y="${n(-(belt + 0.36))}" width="0.2" height="0.3" rx="0.07" fill="#0b0f12"/><rect x="${n(x + 0.03)}" y="${n(-(belt + 0.46))}" width="0.13" height="0.09" rx="0.04" fill="#0b0f12"/>`).join('')}
  <path d="${P(glass)}" fill="none" stroke="#000000" stroke-width="0.06" opacity="0.6"/>
</g>
<path d="M${n(bx - 0.03)} ${n(-(belt + 0.02))} L${n(bx - 0.01)} ${n(-gTop)} L${n(bx + 0.05)} ${n(-gTop)} L${n(bx + 0.04)} ${n(-(belt + 0.02))} Z" fill="#121417" clip-path="url(#glassClip)"/>
<path d="M${n(cx - 0.02)} ${n(-(belt + 0.02))} L${n(cx + 0.06)} ${n(-(gTop - 0.02))} L${n(cx + 0.1)} ${n(-(gTop - 0.02))} L${n(cx + 0.03)} ${n(-(belt + 0.02))} Z" fill="#121417" clip-path="url(#glassClip)"/>
<path d="M${n(gx0 + 0.4)} ${n(-(gTop - 0.02))} L${n(gx0 + 0.6)} ${n(-(gTop - 0.02))} L${n(gx0 + 0.32)} ${n(-(belt + 0.08))} L${n(gx0 + 0.18)} ${n(-(belt + 0.08))} Z" fill="#ffffff" opacity="0.16"/>
<path d="M${n(bx + 0.35)} ${n(-(gTop - 0.02))} L${n(bx + 0.45)} ${n(-(gTop - 0.02))} L${n(bx + 0.25)} ${n(-(belt + 0.08))} L${n(bx + 0.18)} ${n(-(belt + 0.08))} Z" fill="#ffffff" opacity="0.12"/>
<path d="M${n(mirrorX)} ${n(-(belt + 0.02))} C${n(mirrorX + 0.02)} ${n(-(belt + 0.14))} ${n(mirrorX + 0.2)} ${n(-(belt + 0.14))} ${n(mirrorX + 0.2)} ${n(-(belt + 0.05))} L${n(mirrorX + 0.18)} ${n(-(belt - 0.01))} Z" fill="url(#paint)" stroke="#1d1f22" stroke-width="${sw}"/>
${
  a.rails
    ? `<path d="M${n(a.roofRear + 0.05)} ${n(-(H + 0.025))} L${n(L - roofFront - 0.12)} ${n(-(H + 0.03))}" stroke="#1b1d20" stroke-width="0.028" stroke-linecap="round"/>${[a.roofRear + 0.08, L - roofFront - 0.18].map((x) => `<rect x="${n(x - 0.04)}" y="${n(-(H + 0.03))}" width="0.08" height="0.06" fill="#1b1d20"/>`).join('')}`
    : ''
}
${wheelSide(a.axles[0], r)}${wheelSide(a.axles[1], r)}`;
  return svg(f.w, f.h, f.box, body);
}

// ------------------------------------------------------------------ front / back

/** The cross-section seen on the front or the back: body, shoulders, greenhouse (x centred, y up). */
function endOutline(a: CarArt): string {
  const { W, H, wheelR: r, belt } = a;
  const h = W / 2;
  const sill = r * 0.82;
  const roofW = W * 0.34;
  const glassW = W * 0.43;
  const Y = (y: number) => n(-y);
  return [
    `M${n(-h * 0.9)} ${Y(sill - 0.02)}`,
    `C${n(-h * 0.99)} ${Y(sill)} ${n(-h)} ${Y(0.5)} ${n(-h)} ${Y(0.62)}`,
    `C${n(-h * 1.005)} ${Y(belt - 0.12)} ${n(-h * 0.99)} ${Y(belt - 0.02)} ${n(-h * 0.93)} ${Y(belt + 0.02)}`,
    `L${n(-glassW)} ${Y(belt + 0.05)}`,
    `C${n(-glassW + 0.03)} ${Y(H - 0.2)} ${n(-roofW - 0.06)} ${Y(H - 0.02)} ${n(-roofW)} ${Y(H)}`,
    `L${n(roofW)} ${Y(H)}`,
    `C${n(roofW + 0.06)} ${Y(H - 0.02)} ${n(glassW - 0.03)} ${Y(H - 0.2)} ${n(glassW)} ${Y(belt + 0.05)}`,
    `L${n(h * 0.93)} ${Y(belt + 0.02)}`,
    `C${n(h * 0.99)} ${Y(belt - 0.02)} ${n(h * 1.005)} ${Y(belt - 0.12)} ${n(h)} ${Y(0.62)}`,
    `C${n(h)} ${Y(0.5)} ${n(h * 0.99)} ${Y(sill)} ${n(h * 0.9)} ${Y(sill - 0.02)}`,
    'Z',
  ].join(' ');
}

function endView(a: CarArt, end: 'front' | 'back'): string {
  const { W, H, wheelR: r, belt } = a;
  const h = W / 2;
  const f = frame(end, -h - 0.16, 0, h + 0.16, H + 0.04);
  const sw = 0.006;
  const roofW = W * 0.34;
  const glassW = W * 0.43;
  const track = h - 0.12;
  const tyres = [-1, 1]
    .map(
      (s) =>
        `<rect x="${n(s * track - 0.1)}" y="${n(-(r * 1.3))}" width="0.2" height="${n(r * 1.3)}" rx="0.04" fill="url(#tyreSide)"/>`
    )
    .join('');
  const mirror = (s: number) =>
    `<path d="M${n(s * (glassW - 0.02))} ${n(-(belt + 0.04))} L${n(s * (h + 0.13))} ${n(-(belt + 0.06))} C${n(s * (h + 0.16))} ${n(-(belt + 0.12))} ${n(s * (h + 0.13))} ${n(-(belt + 0.18))} ${n(s * (h + 0.06))} ${n(-(belt + 0.17))} L${n(s * (glassW - 0.02))} ${n(-(belt + 0.13))} Z" fill="url(#paint)" stroke="#1d1f22" stroke-width="${sw}"/>`;
  const glassTop = H - 0.06;
  const screen = P([
    [-glassW + 0.06, belt + 0.07],
    [-roofW - 0.01, glassTop],
    [roofW + 0.01, glassTop],
    [glassW - 0.06, belt + 0.07],
  ]);
  const trim = a.blackTrim ? 'url(#trim)' : dark(a.paint, 0.2);
  const plate = `<rect x="-0.26" y="${n(-(end === 'front' ? 0.42 : 0.62))}" width="0.52" height="0.11" rx="0.01" fill="#f4f5f2" stroke="#3a3c3f" stroke-width="${sw}"/>`;
  let face: string;
  if (end === 'front') {
    const lamp = (s: number) =>
      `<path d="${P([
        [s * (h - 0.04), belt - 0.16],
        [s * (h - 0.36), belt - 0.15],
        [s * (h - 0.4), belt - 0.25],
        [s * (h - 0.08), belt - 0.3],
      ])}" fill="url(#lampClear)" stroke="#2c3034" stroke-width="${sw}"/><circle cx="${n(s * (h - 0.17))}" cy="${n(-(belt - 0.23))}" r="0.045" fill="#ffffff"/><circle cx="${n(s * (h - 0.3))}" cy="${n(-(belt - 0.22))}" r="0.03" fill="#f3f7fa"/>`;
    face = `
  <path d="M${n(-glassW + 0.03)} ${n(-(belt + 0.05))} L${n(glassW - 0.03)} ${n(-(belt + 0.05))} L${n(h * 0.86)} ${n(-(belt - 0.13))} L${n(-h * 0.86)} ${n(-(belt - 0.13))} Z" fill="url(#hood)"/>
  ${lamp(-1)}${lamp(1)}
  <path d="M-0.38 ${n(-(belt - 0.17))} L0.38 ${n(-(belt - 0.17))} L0.3 ${n(-(belt - 0.3))} L-0.3 ${n(-(belt - 0.3))} Z" fill="url(#trim)" stroke="#0d0e0f" stroke-width="${sw}"/>
  <path d="M-0.36 ${n(-(belt - 0.2))} L0.36 ${n(-(belt - 0.2))}" stroke="#8e9499" stroke-width="0.012"/>
  <path d="M-0.5 ${n(-0.38)} L0.5 ${n(-0.38)} L0.42 ${n(-(r * 0.9))} L-0.42 ${n(-(r * 0.9))} Z" fill="url(#trim)"/>
  ${[-1, 1].map((s) => `<circle cx="${n(s * (h - 0.2))}" cy="${n(-0.36)}" r="0.04" fill="#e9eef1" stroke="#1a1c1f" stroke-width="0.01"/>`).join('')}
  ${plate}`;
  } else {
    const lamp = (s: number) =>
      a.lamps === 'tall'
        ? `<path d="${P([
            [s * (h - 0.02), belt - 0.12],
            [s * (h - 0.03), H * 0.8],
            [s * (glassW - 0.02), H * 0.78],
            [s * (h - 0.2), belt - 0.08],
            [s * (h - 0.16), belt - 0.16],
          ])}" fill="url(#lampRed)" stroke="#3a0608" stroke-width="${sw}"/><path d="M${n(s * (h - 0.08))} ${n(-(belt - 0.04))} L${n(s * (h - 0.1))} ${n(-(belt + 0.12))}" stroke="#ffd0c8" stroke-width="0.02" opacity="0.8"/>`
        : `<path d="${P([
            [s * (h - 0.02), belt - 0.06],
            [s * (h - 0.42), belt - 0.04],
            [s * (h - 0.42), belt - 0.16],
            [s * (h - 0.05), belt - 0.18],
          ])}" fill="url(#lampRed)" stroke="#3a0608" stroke-width="${sw}"/>`;
    face = `
  ${lamp(-1)}${lamp(1)}
  <path d="M${n(-h * 0.6)} ${n(-(belt - 0.22))} L${n(h * 0.6)} ${n(-(belt - 0.22))}" stroke="${dark(a.paint, 0.35)}" stroke-width="${sw}"/>
  <rect x="${n(-h * 0.98)} " y="${n(-0.42)}" width="${n(h * 1.96)}" height="0.12" fill="${trim}"/>
  ${[-1, 1].map((s) => `<rect x="${n(s * (h - 0.25) - 0.06)}" y="${n(-0.38)}" width="0.12" height="0.025" rx="0.01" fill="#a3131a"/>`).join('')}
  <rect x="-0.08" y="${n(-(H - 0.035))}" width="0.16" height="0.02" rx="0.008" fill="#d4141c"/>
  ${plate}`;
  }
  const wiper =
    end === 'back'
      ? `<path d="M0 ${n(-(belt + 0.1))} L${n(-glassW * 0.55)} ${n(-(belt + 0.2))}" stroke="#111214" stroke-width="0.014" stroke-linecap="round"/>`
      : `<path d="M${n(-glassW * 0.6)} ${n(-(belt + 0.09))} L${n(-0.05)} ${n(-(belt + 0.11))} M${n(0.05)} ${n(-(belt + 0.09))} L${n(glassW * 0.6)} ${n(-(belt + 0.11))}" stroke="#111214" stroke-width="0.012" stroke-linecap="round"/>`;
  const outline = endOutline(a);
  const body = `
${defs(a, 0, H)}
<clipPath id="bodyClip"><path d="${outline}"/></clipPath>
${tyres}
<path d="${outline}" fill="url(#paint)" stroke="#1d1f22" stroke-width="${sw}"/>
<g clip-path="url(#bodyClip)">
  <path d="${outline}" fill="none" stroke="#000000" stroke-opacity="0.3" stroke-width="0.1" filter="url(#soft)"/>
  <ellipse cx="0" cy="${n(-(belt - 0.3))}" rx="${n(h * 0.7)}" ry="0.08" fill="#ffffff" opacity="0.14" filter="url(#soft)"/>
  <path d="M-1 ${n(-(belt - 0.13))} L1 ${n(-(belt - 0.13))}" stroke="url(#shine)" stroke-width="0.016" opacity="0.7"/>
  <rect x="-1" y="${n(-(r * 0.82 + 0.06))}" width="2" height="0.08" fill="${trim}"/>
  ${face}
</g>
<path d="${screen}" fill="url(#glass)" stroke="#121417" stroke-width="0.018" stroke-linejoin="round"/>
<path d="M${n(-roofW * 0.2)} ${n(-(glassTop - 0.02))} L${n(roofW * 0.35)} ${n(-(glassTop - 0.02))} L${n(-glassW * 0.1)} ${n(-(belt + 0.08))} L${n(-glassW * 0.45)} ${n(-(belt + 0.08))} Z" fill="#ffffff" opacity="0.13"/>
${wiper}
${mirror(-1)}${mirror(1)}
${a.rails ? [-1, 1].map((s) => `<rect x="${n(s * (roofW - 0.04) - 0.03)}" y="${n(-(H + 0.05))}" width="0.06" height="0.06" rx="0.01" fill="#1b1d20"/>`).join('') : ''}`;
  return svg(f.w, f.h, f.box, body);
}

// ------------------------------------------------------------------ top

function topView(a: CarArt): string {
  const { L, W, cowl, roofFront, roofRear } = a;
  const h = W / 2;
  const hatch = a.kind !== 'sedan';
  // Nose at the bottom: y = 0 tail (top of the picture), y = −L nose. Drawn with y up → tail at L.
  const f = frame('top', -h - 0.18, 0, h + 0.18, L);
  const Y = (z: number) => n(-(L - z)); // z from the tail
  const sw = 0.006;
  const outline = [
    `M${n(-h * 0.82)} ${Y(0.01)}`,
    `C${n(-h * 0.97)} ${Y(0.03)} ${n(-h)} ${Y(0.2)} ${n(-h)} ${Y(0.45)}`,
    `L${n(-h)} ${Y(L - 0.6)}`,
    `C${n(-h)} ${Y(L - 0.15)} ${n(-h * 0.88)} ${Y(L - 0.02)} ${n(-h * 0.6)} ${Y(L)}`,
    `L${n(h * 0.6)} ${Y(L)}`,
    `C${n(h * 0.88)} ${Y(L - 0.02)} ${n(h)} ${Y(L - 0.15)} ${n(h)} ${Y(L - 0.6)}`,
    `L${n(h)} ${Y(0.45)}`,
    `C${n(h)} ${Y(0.2)} ${n(h * 0.97)} ${Y(0.03)} ${n(h * 0.82)} ${Y(0.01)}`,
    'Z',
  ].join(' ');
  const roofW = W * 0.34;
  const glassW = W * 0.43;
  const rz0 = hatch ? 0.3 : roofRear;
  const rz1 = L - roofFront;
  const screen = P(
    [
      [-glassW, L - cowl],
      [glassW, L - cowl],
      [roofW, rz1],
      [-roofW, rz1],
    ].map(([x, z]) => [x!, L - z!] as const)
  );
  const rear = P(
    (hatch
      ? [
          [-roofW * 0.95, 0.12],
          [roofW * 0.95, 0.12],
          [roofW, rz0 + 0.04],
          [-roofW, rz0 + 0.04],
        ]
      : [
          [-roofW * 0.95, roofRear - 0.4],
          [roofW * 0.95, roofRear - 0.4],
          [roofW, roofRear],
          [-roofW, roofRear],
        ]
    ).map(([x, z]) => [x!, L - z!] as const)
  );
  const sideGlass = (s: number) =>
    P(
      [
        [s * roofW, rz0 + 0.05],
        [s * glassW, rz0 + 0.12],
        [s * glassW, rz1 - 0.05],
        [s * roofW, rz1],
      ].map(([x, z]) => [x!, L - z!] as const)
    );
  const lamps = [-1, 1]
    .map(
      (s) =>
        `<path d="${P(
          [
            [s * (h - 0.02), 0.1],
            [s * (h - 0.25), 0.02],
            [s * (h - 0.05), 0.02],
          ].map(([x, z]) => [x!, L - z!] as const)
        )}" fill="url(#lampRed)"/>`
    )
    .join('');
  const heads = [-1, 1]
    .map(
      (s) =>
        `<path d="${P(
          [
            [s * (h - 0.03), L - 0.25],
            [s * (h - 0.35), L - 0.06],
            [s * (h - 0.12), L - 0.04],
          ].map(([x, z]) => [x!, L - z!] as const)
        )}" fill="url(#lampClear)"/>`
    )
    .join('');
  const mirrorZ = L - cowl - 0.12;
  const mirrors = [-1, 1]
    .map(
      (s) =>
        `<path d="M${n(s * (h - 0.02))} ${Y(mirrorZ)} L${n(s * (h + 0.15))} ${Y(mirrorZ - 0.04)} L${n(s * (h + 0.14))} ${Y(mirrorZ + 0.08)} L${n(s * (h - 0.02))} ${Y(mirrorZ + 0.12)} Z" fill="url(#roof)" stroke="#1d1f22" stroke-width="${sw}"/>`
    )
    .join('');
  const body = `
${defs(a, 0, a.H)}
<linearGradient id="topPaint" gradientUnits="userSpaceOnUse" x1="${n(-h)}" y1="0" x2="${n(h)}" y2="0">
  <stop offset="0" stop-color="${dark(a.paint, 0.3)}"/>
  <stop offset="0.12" stop-color="${a.paint}"/>
  <stop offset="0.3" stop-color="${light(a.paint, 0.35)}"/>
  <stop offset="0.5" stop-color="${light(a.paint, 0.5)}"/>
  <stop offset="0.7" stop-color="${light(a.paint, 0.35)}"/>
  <stop offset="0.88" stop-color="${a.paint}"/>
  <stop offset="1" stop-color="${dark(a.paint, 0.3)}"/>
</linearGradient>
${mirrors}
<path d="${outline}" fill="url(#topPaint)" stroke="#1d1f22" stroke-width="${sw}"/>
<clipPath id="topClip"><path d="${outline}"/></clipPath>
<path d="${outline}" fill="none" stroke="#000000" stroke-opacity="0.3" stroke-width="0.1" filter="url(#soft)" clip-path="url(#topClip)"/>
${lamps}${heads}
<path d="${sideGlass(-1)}" fill="url(#glass)"/><path d="${sideGlass(1)}" fill="url(#glass)"/>
<path d="${screen}" fill="url(#glassTop)" stroke="#121417" stroke-width="0.016"/>
<path d="${rear}" fill="url(#glassTop)" stroke="#121417" stroke-width="0.016"/>
<path d="M${n(-roofW)} ${Y(rz0 + 0.04)} L${n(roofW)} ${Y(rz0 + 0.04)} L${n(roofW)} ${Y(rz1)} L${n(-roofW)} ${Y(rz1)} Z" fill="url(#roof)" stroke="${dark(a.paint, 0.3)}" stroke-width="${sw}"/>
${a.rails ? [-1, 1].map((s) => `<rect x="${n(s * (roofW - 0.04) - 0.025)}" y="${Y(rz0 + 0.1)}" width="0.05" height="${n(rz1 - rz0 - 0.2)}" rx="0.02" fill="#1b1d20"/>`).join('') : ''}
<path d="M${n(-glassW * 0.4)} ${Y(L - cowl - 0.04)} L${n(-glassW * 0.1)} ${Y(L - cowl - 0.04)} L${n(roofW * 0.1)} ${Y(rz1 + 0.04)} L${n(-roofW * 0.25)} ${Y(rz1 + 0.04)} Z" fill="#ffffff" opacity="0.15"/>
<path d="M${n(-h * 0.55)} ${Y(L - cowl + 0.08)} C${n(-h * 0.3)} ${Y(L - 0.2)} ${n(h * 0.3)} ${Y(L - 0.2)} ${n(h * 0.55)} ${Y(L - cowl + 0.08)}" fill="none" stroke="${dark(a.paint, 0.3)}" stroke-width="${sw}"/>`;
  return svg(f.w, f.h, f.box, body);
}

/**
 * The imagined drawing of one face of the car, as an SVG document, on `on` paper (the light blue
 * the reconstruction reads; white for the drawings shown to the operator).
 */
export function carArtSvg(a: CarArt, view: CarArtView, on: string = CAR_ART_PAPER): string {
  paper = on;
  switch (view) {
    case 'right':
      return rightView(a);
    case 'front':
      return endView(a, 'front');
    case 'back':
      return endView(a, 'back');
    case 'top':
      return topView(a);
  }
}

/** The tour's cars, imagined from their photos (VS-T44). */
export const TOUR_CAR_ART: Record<string, CarArt> = {
  // A small silver five-door hatchback seen from the back: tall tail lamps up the hatch.
  'terrace-car': {
    kind: 'hatchback',
    L: 3.8,
    W: 1.7,
    H: 1.5,
    paint: '#9ea3a8',
    wheelR: 0.3,
    axles: [0.62, 3.08],
    belt: 0.98,
    cowl: 0.85,
    roofFront: 1.62,
    roofRear: 0.55,
    deck: 0.98,
    lamps: 'tall',
  },
  // A white estate, nose to the left on its photo: wide tail lamps, big dark alloys, chrome trim.
  'street-car-white': {
    kind: 'estate',
    L: 4.75,
    W: 1.84,
    H: 1.45,
    paint: '#e6e9ec',
    wheelR: 0.34,
    axles: [0.95, 3.78],
    belt: 0.97,
    cowl: 1.12,
    roofFront: 1.9,
    roofRear: 0.32,
    deck: 0.97,
    lamps: 'wide',
    rim: '#6e7276',
    rails: true,
    chrome: true,
  },
  // A black compact MPV seen from its back: tall, upright tail, wide lamps, roof rails.
  'street-car-black': {
    kind: 'mpv',
    L: 4.5,
    W: 1.83,
    H: 1.65,
    paint: '#1c1f24',
    wheelR: 0.33,
    axles: [0.88, 3.6],
    belt: 1.02,
    cowl: 0.95,
    roofFront: 1.7,
    roofRear: 0.3,
    deck: 1.02,
    lamps: 'wide',
    rim: '#8d9297',
    rails: true,
  },
};
