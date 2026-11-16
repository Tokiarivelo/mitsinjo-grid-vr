'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useSimulationStore } from '@/stores';
import { bodyBlocked, type WalkGrid } from '../utils/walk-grid';
import { terrainHeight } from '../utils/landscape';
import { describeXrHands } from '../utils/xr-input-models';
import { useXrInputsShown, XR_INPUT_LAYER } from '../utils/xr-inputs-shown';

export interface SimXrProbeState {
  panel: string | null;
  inside: string | null;
  labels: boolean;
  help: boolean;
  refused: string | null;
  /** The dispatcher's mixing desk is open (VS-T34). */
  mixer: boolean;
}

const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

/**
 * Dev only: lets `make vr-sim-probe` read the /simulation VR session (`window.__VR_SIM__`): head
 * pose, what is shown, world position of a named object, the walk grid and the sector caps.
 */
export function SimXrDevProbe({
  state,
  walkGridRef,
}: {
  state: SimXrProbeState;
  walkGridRef: { current: WalkGrid | null };
}) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const live = useRef(state);
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
  });
  useEffect(() => {
    live.current = state;
  }, [state]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __VR_SIM__?: unknown };
    w.__VR_SIM__ = {
      state: () => live.current,
      /** Frames rendered so far: the probe waits in frames (software GL can take seconds per frame). */
      frames: () => frames.current,
      /** Real hand model vs joint spheres on each hand (VS-T26). */
      hands: () => describeXrHands(gl),
      /**
       * Per input (0 / 1): its grip and ray spaces (shown, parent, distance to the head) and the
       * meshes drawn under the grip (what the viewer should see in the hand).
       */
      inputs: () =>
        ([0, 1] as const).map((i) => {
          const xr = gl.xr as THREE.WebXRManager & {
            getControllerGrip: (n: number) => THREE.Group;
          };
          const grip = xr.getControllerGrip(i);
          const ray = gl.xr.getController(i);
          const head = camera.getWorldPosition(new THREE.Vector3());
          let meshes = 0;
          grip.traverseVisible((o) => {
            if ((o as THREE.Mesh).isMesh) meshes++;
          });
          return {
            grip: grip.visible,
            ray: ray.visible,
            gripParent: grip.parent?.name || grip.parent?.type || null,
            fromHead: Number(
              grip.getWorldPosition(new THREE.Vector3()).distanceTo(head).toFixed(2)
            ),
            meshes,
          };
        }),
      /** Hands & controllers choice, whether the camera draws their layer, and its near plane (VS-T30). */
      inputsShown: () => ({
        shown: useXrInputsShown.getState().shown,
        drawn: camera.layers.isEnabled(XR_INPUT_LAYER),
        near: (camera as THREE.PerspectiveCamera).near,
      }),
      head: () => camera.getWorldPosition(_v).toArray(),
      /** Rig scale: the walker shrinks in the half-scale village (VS-T33). */
      scale: () => camera.parent?.scale.x ?? 1,
      /** Terrain height at (x, z), to read the eye height above the ground. */
      ground: (x: number, z: number) => terrainHeight(x, z),
      yaw: () => _e.setFromQuaternion(camera.getWorldQuaternion(_q), 'YXZ').y,
      shown: (name: string) => {
        let n = 0;
        scene.traverseVisible((o) => {
          if (o.name === name) n++;
        });
        return n;
      },
      worldPos: (name: string) => {
        const o = scene.getObjectByName(name);
        return o ? o.getWorldPosition(new THREE.Vector3()).toArray() : null;
      },
      /** A world point in XR-origin space (what IWER poses use): the camera rig's local space. */
      toOrigin: (p: [number, number, number]) => {
        const rig = camera.parent;
        const v = new THREE.Vector3(...p);
        return (rig ? rig.worldToLocal(v) : v).toArray();
      },
      /** Names of the meshes whose world box holds (x, y, z): what blocks a spot. */
      near: (x: number, y: number, z: number) => {
        const p = new THREE.Vector3(x, y, z);
        const box = new THREE.Box3();
        const m4 = new THREE.Matrix4();
        const names: string[] = [];
        const label = (o: THREE.Object3D) => {
          const path: string[] = [];
          for (let c: THREE.Object3D | null = o; c; c = c.parent) path.push(c.name || c.type);
          return path.slice(0, 4).join(' < ');
        };
        scene.traverseVisible((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const inst = (m as THREE.InstancedMesh).isInstancedMesh
            ? (m as THREE.InstancedMesh)
            : null;
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          for (let k = 0; k < (inst ? inst.count : 1); k++) {
            if (inst) inst.getMatrixAt(k, m4);
            else m4.identity();
            box.copy(m.geometry.boundingBox!).applyMatrix4(m4).applyMatrix4(m.matrixWorld);
            if (box.containsPoint(p)) {
              names.push(
                `${label(m)}${inst ? ` #${k}` : ''} h=${(box.max.y - box.min.y).toFixed(2)}`
              );
              break;
            }
          }
        });
        return names;
      },
      /** Debug: every object named `name`, with its own and its parents' visibility. */
      inspect: (name: string) => {
        const found: Array<Record<string, unknown>> = [];
        scene.traverse((o) => {
          if (o.name !== name) return;
          const chain: string[] = [];
          for (let c: THREE.Object3D | null = o; c; c = c.parent)
            chain.push(`${c.name || c.type}:${c.visible ? 'v' : 'h'}`);
          found.push({ ready: !!o.userData.ready, chain: chain.join(' < ') });
        });
        return found;
      },
      gridReady: () => !!walkGridRef.current,
      blocked: (x: number, z: number) =>
        walkGridRef.current ? bodyBlocked(walkGridRef.current, x, z) : null,
      caps: () => useSimulationStore.getState().input.sectorCaps ?? [],
    };
    return () => {
      delete w.__VR_SIM__;
    };
  }, [camera, scene, gl, walkGridRef]);
  return null;
}
