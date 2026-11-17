import { box, extrude, type PartSpec } from './part-spec';

/** Framed openings (VS-T42, shared since PQ-T88): windows, glass doors, mirrors, doors. */

/** A framed glazed opening (window, glass door, mirror): frame, glass, mullions on a cols × rows grid. */
export function glazing(
  w: number,
  h: number,
  cols: number,
  rows: number,
  frame: string,
  glass: string,
  o: { y0?: number; bar?: number; arch?: boolean; concept?: string; glassConcept?: string } = {}
): PartSpec[] {
  const y0 = o.y0 ?? 0;
  const bar = o.bar ?? 0.05;
  const ring: Array<[number, number]> = o.arch
    ? [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.2],
        ...Array.from({ length: 9 }, (_, i) => {
          const t = (i / 8) * Math.PI;
          return [0.5 * Math.cos(t), 0.2 + 0.3 * Math.sin(t)] as [number, number];
        }).slice(1, 8),
        [-0.5, 0.2],
      ]
    : [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ];
  const out: PartSpec[] = [
    extrude([0, y0 + h / 2, 0], [w, h, 0.06], frame, ring, {
      material: 'wood',
      kind: 'frame',
      concept: o.concept ?? 'window',
    }),
    extrude([0, y0 + h / 2, 0.035], [w - 2 * bar, h - 2 * bar, 0.01], glass, ring, {
      material: 'glass',
      kind: 'body',
      concept: o.glassConcept ?? 'window_pane',
    }),
  ];
  for (let i = 1; i < cols; i++)
    out.push(
      box([-w / 2 + (w / cols) * i, y0 + h / 2, 0.045], [bar * 0.6, h - 2 * bar, 0.02], frame, {
        material: 'wood',
        kind: 'frame',
      })
    );
  for (let j = 1; j < rows; j++)
    out.push(
      box([0, y0 + (h / rows) * j, 0.045], [w - 2 * bar, bar * 0.6, 0.02], frame, {
        material: 'wood',
        kind: 'frame',
      })
    );
  return out;
}

/** A door: one or two leaves with raised panels or glass, a handle. */
export function door(
  w: number,
  h: number,
  color: string,
  o: { leaves?: number; glass?: [number, number] } = {}
): PartSpec[] {
  const leaves = o.leaves ?? 1;
  const lw = w / leaves;
  const out: PartSpec[] = [
    box([0, h / 2, -0.03], [w + 0.12, h + 0.06, 0.04], color, {
      material: 'wood',
      kind: 'frame',
      concept: 'frame',
    }),
  ];
  for (let i = 0; i < leaves; i++) {
    const x = -w / 2 + lw * (i + 0.5);
    if (o.glass)
      out.push(
        ...glazing(lw - 0.02, h, o.glass[0], o.glass[1], color, '#3a4048').map((p) => ({
          ...p,
          at: [p.at[0] + x, p.at[1], p.at[2]] as const,
        }))
      );
    else
      out.push(
        box([x, h / 2, 0], [lw - 0.02, h, 0.05], color, {
          material: 'wood',
          kind: 'body',
          concept: 'door',
        }),
        box([x, h * 0.72, 0.03], [lw * 0.6, h * 0.38, 0.01], color, {
          material: 'wood',
          kind: 'frame',
        }),
        box([x, h * 0.27, 0.03], [lw * 0.6, h * 0.34, 0.01], color, {
          material: 'wood',
          kind: 'frame',
        })
      );
  }
  out.push(
    box([leaves > 1 ? 0.06 : w / 2 - 0.12, h * 0.48, 0.05], [0.04, 0.15, 0.04], '#b8b2a6', {
      material: 'metal',
      kind: 'handle',
      concept: 'handle',
    })
  );
  return out;
}
