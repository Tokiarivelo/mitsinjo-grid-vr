import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SchoolBuilding } from '../school-building';

describe('SchoolBuilding', () => {
  it('renders without throwing with glow=1 and glow=0', () => {
    const { container: lit } = render(<SchoolBuilding glow={1} />);
    expect(lit).toBeDefined();

    const { container: unlit } = render(<SchoolBuilding glow={0} />);
    expect(unlit).toBeDefined();
  });
});
