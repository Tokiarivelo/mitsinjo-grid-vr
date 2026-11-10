import { describe, expect, it } from 'vitest';
import {
  deltaE2000,
  hexToLab,
  insideRings,
  kmeansLab,
  linearToHex,
  linearToLab,
  measureKitColors,
  MIN_MEASURED_PIXELS,
  objectPixels,
  srgbToLinear,
} from '../color-measure';

type Rgb = [number, number, number];
/** Synthetic object: rows of colours, `rows[k]` covers the k-th equal band from the top. */
function bands(rows: Array<Array<{ rgb: Rgb; share: number }>>, perRow = 400) {
  const rgb: number[] = [];
  const y: number[] = [];
  rows.forEach((row, r) => {
    row.forEach(({ rgb: c, share }) => {
      for (let i = 0; i < Math.round(share * perRow); i++) {
        rgb.push(...c);
        y.push((r + 0.5) / rows.length);
      }
    });
  });
  return objectPixels(rgb, y);
}

const STONE: Rgb = [200, 170, 120];
const ROOF: Rgb = [110, 95, 85];
const GLASS: Rgb = [30, 35, 45];
const SKY: Rgb = [150, 190, 240];

describe('colour conversions', () => {
  it('white is L 100, black L 0, and sRGB → linear → hex is lossless', () => {
    expect(linearToLab(1, 1, 1)[0]).toBeCloseTo(100, 0);
    expect(linearToLab(0, 0, 0)[0]).toBeCloseTo(0);
    expect(linearToHex(...srgbToLinear(200, 170, 120))).toBe('#c8aa78');
  });
});

describe('kmeansLab', () => {
  it('splits two colours and is deterministic', () => {
    const px = bands([
      [
        { rgb: STONE, share: 0.5 },
        { rgb: GLASS, share: 0.5 },
      ],
    ]);
    const a = kmeansLab(px.lab, 2);
    expect(new Set(a).size).toBe(2);
    expect(a[0]).not.toBe(a[a.length - 1]);
    expect(Array.from(kmeansLab(px.lab, 2))).toEqual(Array.from(a));
  });
  it('handles no points and k larger than the points', () => {
    expect(kmeansLab(new Float32Array(0), 4)).toHaveLength(0);
    expect(kmeansLab(new Float32Array([50, 0, 0]), 4)).toEqual(new Uint8Array([0]));
  });
});

describe('measureKitColors (PF-T2)', () => {
  it('cottage row: roof on top, stone walls, dark windows (regression: black roof)', () => {
    const px = bands([
      [
        { rgb: ROOF, share: 0.9 },
        { rgb: STONE, share: 0.1 },
      ],
      [
        { rgb: ROOF, share: 0.6 },
        { rgb: STONE, share: 0.4 },
      ],
      [
        { rgb: STONE, share: 0.85 },
        { rgb: GLASS, share: 0.15 },
      ],
      [
        { rgb: STONE, share: 0.85 },
        { rgb: GLASS, share: 0.15 },
      ],
      [{ rgb: STONE, share: 1 }],
    ]);
    expect(measureKitColors(px, 'house')).toEqual({
      main: '#c8aa78',
      secondary: '#6e5f55',
      accent: '#1e232d',
    });
  });

  it('half-timbered walls (PG-T22): plaster wins over beams + shadow, without the option the biggest group', () => {
    const PLASTER: Rgb = [235, 230, 220];
    const BEAM: Rgb = [70, 50, 35];
    const SHADE: Rgb = [140, 120, 100];
    const wall = [
      { rgb: SHADE, share: 0.4 },
      { rgb: PLASTER, share: 0.35 },
      { rgb: BEAM, share: 0.25 },
    ];
    const px = bands([[{ rgb: ROOF, share: 1 }], [{ rgb: ROOF, share: 1 }], wall, wall, wall]);
    expect(measureKitColors(px, 'house')!.main).toBe('#8c7864');
    expect(measureKitColors(px, 'house', { plaster: true })!.main).toBe('#ebe6dc');
    expect(measureKitColors(px, 'house', { plaster: true })!.secondary).toBe('#6e5f55');
  });

  it('tree: crown is main, the trunk below is secondary', () => {
    const LEAF: Rgb = [60, 120, 50];
    const BARK: Rgb = [90, 60, 40];
    const px = bands([
      [{ rgb: LEAF, share: 1 }],
      [{ rgb: LEAF, share: 1 }],
      [
        { rgb: LEAF, share: 0.8 },
        { rgb: BARK, share: 0.2 },
      ],
      [
        { rgb: BARK, share: 0.3 },
        { rgb: LEAF, share: 0.1 },
      ],
    ]);
    const c = measureKitColors(px, 'tree')!;
    expect(c.main).toBe(linearToHex(...srgbToLinear(...LEAF)));
    expect(c.secondary).toBe(linearToHex(...srgbToLinear(...BARK)));
  });

  it('too few pixels inside the outline → null (Spark colours stay)', () => {
    const px = bands([[{ rgb: SKY, share: 1 }]], MIN_MEASURED_PIXELS - 1);
    expect(measureKitColors(px, 'house')).toBeNull();
  });

  it('one flat colour → the same colour for every role (no crash)', () => {
    const c = measureKitColors(bands([[{ rgb: STONE, share: 1 }]]), 'cabinet')!;
    expect(c).toEqual({ main: '#c8aa78', secondary: '#c8aa78', accent: '#c8aa78' });
  });
});

describe('insideRings', () => {
  const square = [
    [
      [0.2, 0.2],
      [0.6, 0.2],
      [0.6, 0.6],
      [0.2, 0.6],
    ] as const,
  ];
  it('tells inside from outside', () => {
    expect(insideRings(0.4, 0.4, square)).toBe(true);
    expect(insideRings(0.1, 0.4, square)).toBe(false);
    expect(insideRings(0.4, 0.7, square)).toBe(false);
  });
});

describe('deltaE2000 (PF-T9)', () => {
  // Sharma, Wu & Dalal (2005) reference pairs.
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  ] as const)('%j vs %j → %f', (a, b, want) => {
    expect(deltaE2000(a, b)).toBeCloseTo(want, 3);
    expect(deltaE2000(b, a)).toBeCloseTo(want, 3);
  });

  it('same colour → 0; hexToLab white ≈ L 100', () => {
    expect(deltaE2000(hexToLab('#c9a36a'), hexToLab('#c9a36a'))).toBe(0);
    expect(hexToLab('#ffffff')[0]).toBeCloseTo(100, 1);
  });
});

describe('colour on the lit surface (PQ-T10)', () => {
  const SHADOWED: Rgb = [105, 90, 63];

  it('a wall mostly in shadow reads the lit colour within ΔE 5, and reports the shadow share', () => {
    // 35 % lit stone, 65 % the same stone in shadow (before: the biggest group = the shadow).
    const px = bands([
      [{ rgb: ROOF, share: 1 }],
      [
        { rgb: STONE, share: 0.35 },
        { rgb: SHADOWED, share: 0.65 },
      ],
      [
        { rgb: STONE, share: 0.35 },
        { rgb: SHADOWED, share: 0.65 },
      ],
    ]);
    let shadow = 0;
    const c = measureKitColors(px, 'house', {
      litSurface: true,
      onShadowShare: (s) => (shadow = s),
    })!;
    expect(deltaE2000(hexToLab(c.main), hexToLab('#c8aa78'))).toBeLessThan(5);
    expect(shadow).toBeGreaterThan(0.3);
  });

  it('a different material is not taken for a shadow (blue sky stays apart)', () => {
    const px = bands([
      [{ rgb: SKY, share: 1 }],
      [{ rgb: STONE, share: 1 }],
      [{ rgb: STONE, share: 1 }],
    ]);
    let shadow = -1;
    measureKitColors(px, 'house', { litSurface: true, onShadowShare: (s) => (shadow = s) });
    expect(shadow).toBe(0);
  });
});
