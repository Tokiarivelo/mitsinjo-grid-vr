import * as THREE from 'three';

/**
 * Softbox studio (PT-2): the light a product photographer would set, as a scene pre-filtered once into
 * the editor's environment map. A big top softbox gives the long highlight line on gloss parts, two tall
 * side strips draw the silhouette, a low front kicker lifts the shadow side, a grey floor disc grounds the
 * reflections. Emissive levels (linear, > 1 = brighter than white) are the only tuning knobs.
 */
export const STUDIO_LIGHT = {
  /** Room shell: the soft fill everywhere the lights are not. */
  room: 0.6,
  top: 5,
  side: 3,
  kicker: 2.4,
  floor: 0.3,
} as const;

/** PMREM blur of the studio (sharper than the old room's 0.04, so softbox edges read on glossy parts). */
export const STUDIO_SIGMA = 0.02;

/** Meshes of the studio: shell, top softbox, two side strips, front kicker, floor disc. */
export const STUDIO_MESHES = 6;

export interface StudioScene {
  scene: THREE.Scene;
  /** Frees every geometry and material of the studio (the scene is only needed to bake the PMREM). */
  dispose: () => void;
}

function panel(
  w: number,
  h: number,
  level: number,
  at: readonly [number, number, number]
): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setScalar(level),
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(...at);
  mesh.lookAt(0, 0, 0);
  return mesh;
}

/** The studio scene, centred on an object of about 1 × 1 × 1 at the origin. Pure: no renderer. */
export function buildStudioScene(): StudioScene {
  const scene = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(12, 24, 12),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setScalar(STUDIO_LIGHT.room),
      side: THREE.BackSide,
    })
  );
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(STUDIO_LIGHT.floor) })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  scene.add(
    shell,
    panel(5, 5, STUDIO_LIGHT.top, [0, 7, 1]),
    panel(1.2, 6, STUDIO_LIGHT.side, [-6, 1.5, 2]),
    panel(1.2, 6, STUDIO_LIGHT.side, [6, 1.5, -1]),
    panel(6, 1.6, STUDIO_LIGHT.kicker, [0, -0.8, 6]),
    floor
  );
  const dispose = () =>
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
  return { scene, dispose };
}

/** Studio environment baked once per renderer for objects that cannot own the scene's environment (VR miniatures, PQ-T32). */
const shared = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget>();

/**
 * The pre-filtered studio (PMREM) as a render target: the caller owns it and disposes it. Needs a renderer.
 */
export function bakeStudioEnv(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(gl);
  const studio = buildStudioScene();
  const target = pmrem.fromScene(studio.scene, STUDIO_SIGMA);
  studio.dispose();
  pmrem.dispose();
  return target;
}

/** The studio environment of a renderer, baked on first use and kept for its life (shared, never disposed by callers). */
export function sharedStudioEnv(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  let target = shared.get(gl);
  if (!target) {
    target = bakeStudioEnv(gl);
    shared.set(gl, target);
  }
  return target;
}
