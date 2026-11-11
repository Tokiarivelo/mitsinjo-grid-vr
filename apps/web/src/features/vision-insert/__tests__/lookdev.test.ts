import { describe, expect, it } from 'vitest';
import { LIGHT_SETUPS, LOOKDEV_PRESETS, lookdevPreset } from '../utils/lookdev';
import { LOOKDEV_LIGHTS, shotPlan } from '../../../../scripts/lookdev-plan.mjs';

describe('look-development sheet (PQ-T40)', () => {
  it('LOOKDEV writes three shots per object and theme, plain shots otherwise', () => {
    const names = ['car', 'lamp post'];
    const plan = shotPlan(names, { lookdev: true });
    expect(plan).toHaveLength(names.length * 2 * 3);
    for (const name of names)
      for (const theme of ['dark', 'light'])
        expect(
          plan.filter((p) => p.name === name && p.theme === theme).map((p) => p.light)
        ).toEqual(['studio', 'side', 'back']);
    expect(new Set(plan.map((p) => p.file)).size).toBe(plan.length);
    expect(plan[0]!.file).toBe('car-lookdev-studio-dark.png');
    const plain = shotPlan(names, { suffix: 'before' });
    expect(plain).toHaveLength(4);
    expect(plain[0]!.file).toBe('car-before-dark.png');
  });

  it('the script and the viewer agree on the three lights', () => {
    expect([...LOOKDEV_LIGHTS]).toEqual([...LOOKDEV_PRESETS]);
    for (const p of LOOKDEV_PRESETS) {
      expect(LIGHT_SETUPS[p].key.intensity).toBeGreaterThan(0);
      expect(LIGHT_SETUPS[p].key.position).toHaveLength(3);
    }
  });

  it('?lookdev picks a preset, anything else is the studio', () => {
    expect(lookdevPreset('?lookdev=side')).toBe('side');
    expect(lookdevPreset('?lookdev=back&x=1')).toBe('back');
    expect(lookdevPreset('')).toBe('studio');
    expect(lookdevPreset('?lookdev=disco')).toBe('studio');
  });
});
