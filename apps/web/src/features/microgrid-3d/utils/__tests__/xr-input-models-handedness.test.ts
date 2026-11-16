import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// Factories without network: a hand model takes the handedness of its first connection, as three's does.
vi.mock('../three-xr-factories', () => {
  class XRHandModelFactory {
    setPath() {
      return this;
    }
    createHandModel(space: THREE.Object3D) {
      const model = new THREE.Object3D() as THREE.Object3D & {
        motionController: unknown;
        xrInputSource?: XRInputSource;
      };
      model.motionController = null;
      space.addEventListener(
        'connected' as never,
        ((e: { data: XRInputSource }) => {
          if (!e.data.hand || model.motionController) return;
          model.xrInputSource = e.data;
          model.motionController = {};
          model.add(new THREE.Mesh());
        }) as never
      );
      return model;
    }
  }
  class XRControllerModelFactory {
    setPath() {
      return this;
    }
    createControllerModel() {
      return new THREE.Object3D();
    }
  }
  return { XRHandModelFactory, XRControllerModelFactory };
});

const { attachInputModels } = await import('../xr-input-models');

const source = (handedness: XRHandedness) => ({ hand: {}, handedness }) as unknown as XRInputSource;
type Handed = THREE.Object3D & { xrInputSource?: XRInputSource };

describe('real hand model follows the hand it is given (VS-T26)', () => {
  it('loads a fresh model when the space gets the other hand', () => {
    const space = new THREE.Group();
    const gl = { xr: { getSession: () => null } } as unknown as THREE.WebGLRenderer;
    const m = attachInputModels(gl, 0, { hand: space });
    space.dispatchEvent({ type: 'connected', data: source('left') } as never);
    expect(m.handLoaded()).toBe(true);
    const first = space.children.at(-1) as Handed;
    expect(first.xrInputSource?.handedness).toBe('left');

    // Same hand again (mode switch back and forth): the model is kept.
    space.dispatchEvent({ type: 'connected', data: source('left') } as never);
    expect(space.children.at(-1)).toBe(first);

    // The other hand on this space: a new model, for that hand.
    space.dispatchEvent({ type: 'connected', data: source('right') } as never);
    const second = space.children.at(-1) as Handed;
    expect(second).not.toBe(first);
    expect(space.children).not.toContain(first);
    expect(second.xrInputSource?.handedness).toBe('right');
    expect(m.handLoaded()).toBe(true);

    m.dispose();
    expect(space.children).toHaveLength(0);
  });
});
