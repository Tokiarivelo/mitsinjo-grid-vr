import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PowerConnectionBeam } from '../power-connection-beam';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

describe('PowerConnectionBeam', () => {
  it('renders conduit tube and ground terminal junction', () => {
    const { container } = render(
      <PowerConnectionBeam from={[0.5, 0.4, -2.0]} to={[0, 0, -1.5]} color="#22c55e" />
    );

    const group = container.querySelector('[name="power-connection-beam"]');
    expect(group).toBeTruthy();

    const meshes = group?.querySelectorAll('mesh');
    expect(meshes?.length).toBeGreaterThanOrEqual(3);
  });
});
