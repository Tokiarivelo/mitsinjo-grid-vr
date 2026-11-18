import * as THREE from 'three';
import { Locomotor, sampleParabolicCurve } from '@iwsdk/locomotor';
import { stepWalk, type Ground, type WalkAxes } from './tour/tour-nav';

/**
 * Walking in the 3D studio on Meta's IWSDK locomotion engine (IW-T2, `@iwsdk/locomotor`, synchronous
 * engine, no worker): a slide driven by the left stick and a parabolic teleport arc, on an invisible
 * floor disc a little wider than the walkable radius. Coordinates are the studio's own ("walk
 * space": its floor at y 0, the door at the origin), so the studio keeps moving against the walk.
 */

/**
 * The floor reaches this far past the walk radius (the studio dome is 7 m): an arc landing past the
 * radius is pulled back to its edge, and the engine never sees an edge to fall off.
 */
export const STUDIO_FLOOR_MARGIN = 8;
/** Teleport arc and landing ring colour: the hands' and lasers' cyan. */
export const ARC_COLOR = '#7dd3fc';
/** Points of the drawn teleport arc. */
export const ARC_POINTS = 24;
/** Arc gravity, IWSDK's default (`rayGravity`) for a unit aim direction. */
export const ARC_GRAVITY = -0.4;
/** The player capsule floats this high above the floor when it starts (m). */
const START_HEIGHT = 0.1;

/** Ground point `g` pulled back inside `radius` of the door. */
export function clampToRadius(g: Ground, radius: number): Ground {
  const r = Math.hypot(g[0], g[1]);
  return r > radius ? [(g[0] * radius) / r, (g[1] * radius) / r] : g;
}

/** Head-relative walk velocity (m/s, [x, z]) for the stick axes: the tour's walk speed. */
export function walkVelocity(axes: WalkAxes, headYaw: number): Ground {
  return stepWalk([0, 0], axes, headYaw, 1, Number.POSITIVE_INFINITY);
}

/** A world point (XR space) in walk space: the studio sits at `-offset`. */
export function toWalkSpace(world: THREE.Vector3, offset: Ground, out: THREE.Vector3) {
  return out.set(world.x + offset[0], world.y, world.z + offset[1]);
}

/** Teleport target of an arc hit: on the floor, inside the walk radius; null without a hit. */
export function teleportTarget(hit: THREE.Vector3 | null, radius: number): Ground | null {
  return hit ? clampToRadius([hit.x, hit.z], radius) : null;
}

const _slide = new THREE.Vector3();
const _to = new THREE.Vector3();
const _back = new THREE.Vector3();

export class StudioLocomotion {
  readonly locomotor = new Locomotor({
    useWorker: false,
    initialPlayerPosition: new THREE.Vector3(0, START_HEIGHT, 0),
  });
  /** Arc samples in walk space (filled by `aim`). */
  readonly arc = Array.from({ length: ARC_POINTS }, () => new THREE.Vector3());
  private readonly floor: THREE.Mesh;
  private ready = false;
  private disposed = false;

  constructor(readonly radius: number) {
    const geo = new THREE.CircleGeometry(radius + STUDIO_FLOOR_MARGIN, 32).rotateX(-Math.PI / 2);
    this.floor = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    this.floor.updateMatrixWorld(true);
    this.locomotor
      .initialize()
      .then(() => {
        if (this.disposed) return;
        this.locomotor.addEnvironment(this.floor);
        this.ready = true;
      })
      .catch((err: unknown) =>
        console.warn('[iwsdk] locomotor not started, simple walk stays:', err)
      );
  }

  /** The engine is up (until then the caller keeps its simple walk). */
  isReady(): boolean {
    return this.ready;
  }

  /** Where the viewer stands, [x, z] in walk space. */
  ground(): Ground {
    const p = this.locomotor.position;
    return [p.x, p.z];
  }

  /** One frame of stick walking; returns the new ground, kept inside the radius. */
  walk(axes: WalkAxes, headYaw: number, dt: number): Ground {
    const [vx, vz] = walkVelocity(axes, headYaw);
    this.locomotor.slide(_slide.set(vx, 0, vz));
    this.locomotor.update(dt);
    const g = this.ground();
    const kept = clampToRadius(g, this.radius);
    if (kept !== g) this.place(kept);
    return kept;
  }

  /** Puts the viewer at `g` (a snap step, a landed teleport). */
  place(g: Ground): void {
    const [x, z] = clampToRadius(g, this.radius);
    this.locomotor.teleport(_to.set(x, Math.max(this.locomotor.position.y, START_HEIGHT), z));
  }

  /**
   * Aims the arc from `origin` along the ray's forward `direction` (walk space, unit): fills `arc`,
   * returns the teleport target or null when the arc lands nowhere. IWSDK's parabola runs its time
   * backwards (negative end time with its negative gravity): it takes the controller's +Z axis, the
   * opposite of where the ray points, so the direction is flipped here.
   */
  aim(origin: THREE.Vector3, direction: THREE.Vector3): Ground | null {
    _back.copy(direction).negate();
    sampleParabolicCurve(origin, _back, 0, ARC_GRAVITY, this.arc);
    this.locomotor.requestHitTest(origin, _back);
    const target = this.locomotor.hitTestTarget;
    return teleportTarget(target.visible ? target.position : null, this.radius);
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.locomotor.terminate();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
  }
}
