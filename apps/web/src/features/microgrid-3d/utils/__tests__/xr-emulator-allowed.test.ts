import { describe, expect, it } from 'vitest';
import { xrEmulatorAllowed } from '../dev-xr-emulator';

describe('xrEmulatorAllowed (production immersion without a headset)', () => {
  it('dev always, production unless NEXT_PUBLIC_XR_EMULATOR=off, never under tests', () => {
    expect(xrEmulatorAllowed('development', 'off')).toBe(true);
    expect(xrEmulatorAllowed('production', 'on')).toBe(true);
    expect(xrEmulatorAllowed('production', 'off')).toBe(false);
    expect(xrEmulatorAllowed('test', 'on')).toBe(false);
  });
});
