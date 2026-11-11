// Shot plan of `make shape-shots` (PQ-T40): one entry per file written. LOOKDEV=1 adds the three lights.
export const LOOKDEV_LIGHTS = ['studio', 'side', 'back'];
export const THEMES = ['dark', 'light'];

/** Files for each theme, object and light: `name-lookdev-side-dark.png`, or `name-dark.png` without LOOKDEV. */
export function shotPlan(names, { lookdev = false, suffix = '' } = {}) {
  const lights = lookdev ? LOOKDEV_LIGHTS : [null];
  const sfx = suffix ? `-${suffix}` : '';
  return THEMES.flatMap((theme) =>
    names.flatMap((name) =>
      lights.map((light) => ({
        theme,
        name,
        light,
        file: `${name.replace(/\W+/g, '-')}${light ? `-lookdev-${light}` : ''}${sfx}-${theme}.png`,
      }))
    )
  );
}
