import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ClinicBuilding } from '../clinic-building';

describe('ClinicBuilding', () => {
  it('renders without throwing with glow=1 and glow=0', () => {
    const { container: lit } = render(<ClinicBuilding glow={1} />);
    expect(lit).toBeDefined();

    const { container: unlit } = render(<ClinicBuilding glow={0} />);
    expect(unlit).toBeDefined();
  });
});
