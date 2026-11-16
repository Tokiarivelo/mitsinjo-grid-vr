/**
 * Immersion state in the URL (VS-T33): `?immersion=vr` while a page shows its VR immersion
 * (/simulation, /village), plus `lab=2d|3d` on /village while the studio desks are open. Pure.
 * Other query params are kept as they are.
 */
export const IMMERSION_PARAM = 'immersion';
export const IMMERSION_VR = 'vr';
export const LAB_PARAM = 'lab';

export type ImmersionLab = '2d' | '3d';

export interface ImmersionQuery {
  immersion: boolean;
  /** Studio desk shown in the /village immersion; ignored without `immersion`. */
  lab?: ImmersionLab | null;
}

/** Reads `?immersion=vr&lab=…` from a `location.search` string. */
export function readImmersionQuery(search: string): ImmersionQuery {
  const params = new URLSearchParams(search);
  const immersion = params.get(IMMERSION_PARAM) === IMMERSION_VR;
  const lab = params.get(LAB_PARAM);
  return { immersion, lab: immersion && (lab === '2d' || lab === '3d') ? lab : null };
}

/** `search` with the immersion params set (or removed): `?…` or `''`. */
export function withImmersionQuery(search: string, q: ImmersionQuery): string {
  const params = new URLSearchParams(search);
  params.delete(IMMERSION_PARAM);
  params.delete(LAB_PARAM);
  if (q.immersion) {
    params.set(IMMERSION_PARAM, IMMERSION_VR);
    if (q.lab) params.set(LAB_PARAM, q.lab);
  }
  const out = params.toString();
  return out ? `?${out}` : '';
}

/** Link to `path` in immersion: `/simulation?immersion=vr`. */
export function immersionHref(path: string, q: ImmersionQuery = { immersion: true }): string {
  return path + withImmersionQuery('', q);
}

/** Studio stage (`useXrExtract`) → desk in the URL: 2D lab (views), 3D lab (build, lab). */
export function labOfStage(stage: string | undefined): ImmersionLab | null {
  if (stage === 'views') return '2d';
  if (stage === 'build' || stage === 'lab') return '3d';
  return null;
}
