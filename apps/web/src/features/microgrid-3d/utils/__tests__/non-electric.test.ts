import { describe, expect, it } from 'vitest';
import { HORIZON_H, HourlyDutySchema } from '@mitsinjo/engine';
import { isNonElectric, NO_LOAD_DUTY } from '../non-electric';

describe('non-electric lines (VS-T40)', () => {
  it('NO_LOAD_DUTY is a valid engine duty, zero every hour', () => {
    expect(NO_LOAD_DUTY).toHaveLength(HORIZON_H);
    expect(HourlyDutySchema.safeParse([...NO_LOAD_DUTY]).success).toBe(true);
    expect(isNonElectric({ hourlyDuty: NO_LOAD_DUTY })).toBe(true);
  });

  it('a line with no duty (catalog profile) or any use is electric', () => {
    expect(isNonElectric({})).toBe(false);
    const once = [...NO_LOAD_DUTY];
    once[12] = 0.5;
    expect(isNonElectric({ hourlyDuty: once })).toBe(false);
  });
});
