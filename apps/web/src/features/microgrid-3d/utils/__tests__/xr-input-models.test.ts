import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// Fake IWSDK manager (no WebXR in jsdom): records the pointers turned off and the updates.
interface FakeManager {
  xrOrigin: THREE.Group;
  toggled: string[];
  updates: number;
  visualAdapters: Record<
    'hand' | 'controller',
    Record<'left' | 'right', { visual?: { model: THREE.Object3D } }>
  >;
}
vi.mock('../iwsdk-xr-input', async () => {
  const T = await import('three');
  const made: unknown[] = [];
  class XRInputManager {
    xrOrigin = new T.Group();
    toggled: string[] = [];
    updates = 0;
    multiPointers = {
      left: { toggleSubPointer: (k: string, on: boolean) => this.toggled.push(`left:${k}:${on}`) },
      right: {
        toggleSubPointer: (k: string, on: boolean) => this.toggled.push(`right:${k}:${on}`),
      },
    };
    visualAdapters = { hand: { left: {}, right: {} }, controller: { left: {}, right: {} } };
    constructor() {
      made.push(this);
    }
    update() {
      this.updates++;
    }
  }
  return { XRInputManager, made };
});

import { attachInputModels, describeXrHands, modelLoaded } from '../xr-input-models';
import { IWSDK_POINTER_KINDS, releaseIwsdkInput, iwsdkInputOf } from '../iwsdk-input';
import { XR_INPUT_LAYER } from '../xr-inputs-shown';
import * as shim from '../iwsdk-xr-input';

const made = (shim as unknown as { made: unknown[] }).made;

const fakeGl = (
  frame: object | null = null,
  sources: Partial<XRInputSource>[] = [],
  spaces = [new THREE.Group(), new THREE.Group()]
) =>
  ({
    xr: {
      getController: (i: number) => spaces[i],
      isPresenting: !!frame,
      getFrame: () => frame,
      getSession: () => ({ inputSources: sources }),
      getHand: () => new THREE.Group(),
    },
  }) as unknown as THREE.WebGLRenderer;

describe('IWSDK input models (IW-T1)', () => {
  it('one manager per renderer, IWSDK pointers all off, rig under the parent', () => {
    const gl = fakeGl();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const a = attachInputModels(gl, 0, {}, { scene, camera });
    const b = attachInputModels(gl, 1, {}, { scene, camera });
    expect(made.filter((m) => (m as unknown) === iwsdkInputOf(gl)?.manager)).toHaveLength(1);
    const m = iwsdkInputOf(gl)!.manager as unknown as FakeManager;
    expect(m.toggled).toHaveLength(2 * IWSDK_POINTER_KINDS.length);
    expect(m.toggled.every((t) => t.endsWith(':false'))).toBe(true);
    expect(m.xrOrigin.parent).toBe(scene);
    a.dispose();
    expect(m.xrOrigin.parent).toBe(scene); // still attached once
    b.dispose();
    expect(m.xrOrigin.parent).toBeNull();
  });

  it('the rig follows the latest parent and goes back on release (lab suspended, VS-T49)', () => {
    const gl = fakeGl();
    const scene = new THREE.Scene();
    const rig = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    attachInputModels(gl, 0, {}, { scene, camera });
    const rt = iwsdkInputOf(gl)!;
    attachInputModels(gl, 0, {}, { scene, camera, parent: rig });
    expect(rt.manager.xrOrigin.parent).toBe(rig);
    releaseIwsdkInput(rt, rig);
    expect(rt.manager.xrOrigin.parent).toBe(scene);
  });

  it('ticks IWSDK once per XR frame, whoever calls it', () => {
    const frame = {};
    const gl = fakeGl(frame);
    const scene = new THREE.Scene();
    const models = attachInputModels(gl, 0, {}, { scene, camera: new THREE.PerspectiveCamera() });
    models.tick();
    models.tick();
    const m = iwsdkInputOf(gl)!.manager as unknown as FakeManager;
    expect(m.updates).toBe(1);
  });

  it('loaded once IWSDK has the model of that side; the stand-in shows only until then', () => {
    const gl = fakeGl({}, [{ handedness: 'right' }]);
    const scene = new THREE.Scene();
    const fallback = new THREE.Group();
    const models = attachInputModels(
      gl,
      0,
      { gripFallback: fallback },
      { scene, camera: new THREE.PerspectiveCamera() }
    );
    expect(models.gripLoaded()).toBe(false);
    expect(fallback.visible).toBe(true);
    const m = iwsdkInputOf(gl)!.manager as unknown as FakeManager;
    const controller = new THREE.Group();
    controller.add(new THREE.Mesh());
    m.visualAdapters.controller.right.visual = {
      model: controller,
    };
    expect(models.gripLoaded()).toBe(true);
    expect(fallback.visible).toBe(false);
    // On the input layer (hide / show the models, VS-T30).
    expect(controller.children[0]!.layers.isEnabled(XR_INPUT_LAYER)).toBe(true);
    expect(models.handLoaded()).toBe(false);
    expect(describeXrHands(gl)[0]).toMatchObject({ real: false });
  });

  it("reads the side from three's connected event, not inputSources[index] (IWE extension)", () => {
    // The IWE extension keeps both controllers listed in hand mode: slot 0 is the right hand.
    const spaces = [new THREE.Group(), new THREE.Group()];
    const gl = fakeGl({}, [{ handedness: 'left' }, { handedness: 'right' }], spaces);
    const scene = new THREE.Scene();
    const models = attachInputModels(gl, 0, {}, { scene, camera: new THREE.PerspectiveCamera() });
    const m = iwsdkInputOf(gl)!.manager as unknown as FakeManager;
    const hand = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh());
      return { model: g };
    };
    m.visualAdapters.hand.right.visual = hand();
    expect(models.handLoaded()).toBe(false); // inputSources[0] says left
    spaces[0]!.dispatchEvent({ type: 'connected', data: { handedness: 'right' } } as never);
    expect(models.handLoaded()).toBe(true);
    spaces[0]!.dispatchEvent({ type: 'disconnected' } as never);
    expect(models.handLoaded()).toBe(false);
    // Both real hands loaded: stand-ins hidden whatever the slot order.
    m.visualAdapters.hand.left.visual = hand();
    expect(models.handLoaded()).toBe(true);
    models.dispose();
  });

  it('modelLoaded needs a mesh under the model', () => {
    expect(modelLoaded(null)).toBe(false);
    expect(modelLoaded(new THREE.Group())).toBe(false);
    const g = new THREE.Group();
    g.add(new THREE.Mesh());
    expect(modelLoaded(g)).toBe(true);
  });
});
