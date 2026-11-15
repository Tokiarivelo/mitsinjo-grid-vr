import { act, renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const frame = vi.hoisted(() => ({
  cb: null as null | ((s: { clock: { elapsedTime: number } }) => void),
}));
vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: typeof frame.cb) => {
    frame.cb = cb;
  },
}));

import { useHoloImageMaterial } from '../holo-ui';
import type { HoloImageMaterial } from '../holo-style';

describe('useHoloImageMaterial (carousel slides, studio miniature)', () => {
  it('shows the texture with the rim colour, animates, focuses, and frees the material', () => {
    const texture = new THREE.Texture();
    const { result, rerender, unmount } = renderHook(
      ({ rim }: { rim: string }) => useHoloImageMaterial(texture, rim),
      { initialProps: { rim: '#00ff00' } }
    );
    const m = result.current.material as HoloImageMaterial;
    expect(m.uniforms.uMap.value).toBe(texture);
    expect(m.uniforms.uRim.value.getHexString()).toBe('00ff00');

    rerender({ rim: '#ff0000' });
    expect(result.current.material).toBe(m); // one material for the component's life
    expect(m.uniforms.uRim.value.getHexString()).toBe('ff0000');

    act(() => frame.cb?.({ clock: { elapsedTime: 2.5 } }));
    expect(m.uniforms.uTime.value).toBe(2.5);
    result.current.setFocus(0.4);
    expect(m.uniforms.uFocus.value).toBe(0.4);

    const dispose = vi.spyOn(m, 'dispose');
    unmount();
    expect(dispose).toHaveBeenCalled();
  });
});
