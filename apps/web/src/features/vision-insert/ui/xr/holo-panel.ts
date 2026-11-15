import { useCallback, useEffect, useRef } from 'react';
import type * as THREE from 'three';

/**
 * Holographic panels of the /village VR studio (VS-T19): dialog buttons, the views carousel, the
 * 3D lab tools. Each panel mesh registers here; `XRBlasterController` (the only input source)
 * raycasts the registered meshes first, so a panel takes the hover and the shot before the 360°
 * photo behind it. A panel may also be dragged (select held + pointer turned sideways): Meta
 * guidance for ray UI is pinch-and-drag anywhere on the content, no scroll bar.
 */
export interface HoloPanelHandlers {
  /** Shot / tap on the panel; `hit` names the mesh under the ray (the lab model's piece). */
  onSelect?: (hit: THREE.Intersection) => void;
  /** Held select moved sideways: `dx` in radians of pointer yaw (right = positive). */
  onDrag?: (dx: number) => void;
  /** The drag ended (snap the carousel). */
  onDragEnd?: () => void;
}

export interface HoloPanelData extends HoloPanelHandlers {
  id: string;
}

/** Every panel id starts with it (hover tick sound, studio hover state). */
export const HOLO_ID_PREFIX = 'holo:';

/** Key of the panel data in `Object3D.userData`. */
export const HOLO_PANEL_KEY = 'holoPanel';

export interface PanelRegistry {
  readonly objects: THREE.Object3D[];
  add: (object: THREE.Object3D) => void;
  remove: (object: THREE.Object3D) => void;
}

export function createPanelRegistry(): PanelRegistry {
  const objects: THREE.Object3D[] = [];
  return {
    objects,
    add: (o) => {
      if (!objects.includes(o)) objects.push(o);
    },
    remove: (o) => {
      const i = objects.indexOf(o);
      if (i >= 0) objects.splice(i, 1);
    },
  };
}

/** Panel data carried by `object` or its nearest registered ancestor. */
export function panelOf(object: THREE.Object3D | null): HoloPanelData | null {
  for (let o = object; o; o = o.parent) {
    const data = o.userData?.[HOLO_PANEL_KEY] as HoloPanelData | undefined;
    if (data) return data;
  }
  return null;
}

/** True when the object and all its ancestors are visible (raycasting ignores `visible`). */
export function shown(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Net pointer turn (rad, ≈ 4°) under which a held select released is a tap, not a drag. Net, not
 * summed: hand tremor and the pinch itself move the ray a little back and forth (Meta: ray drift
 * on pinch), which must never turn a tap into a drag.
 */
export const PANEL_TAP_SLOP = 0.07;

/** A select held on a panel: tap when released before turning past the slop. */
export interface PanelDrag {
  panel: HoloPanelData;
  hit: THREE.Intersection;
  /** Last pointer yaw (rad). */
  yaw: number;
  /** Largest net turn from the press so far (rad); past the slop it is a drag for good. */
  moved: number;
  /** Pointer yaw at the press; set on the first sample. */
  start?: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Feeds one pointer yaw sample to a drag; returns the yaw step (rad) it passed to `onDrag`. */
export function dragTo(drag: PanelDrag, yaw: number): number {
  drag.start ??= drag.yaw;
  const step = wrap(yaw - drag.yaw);
  drag.yaw = yaw;
  // Only a panel that drags (carousel, model) can stop being a tap.
  if (!drag.panel.onDrag) return 0;
  const net = Math.abs(wrap(yaw - drag.start));
  const wasDrag = drag.moved > PANEL_TAP_SLOP;
  drag.moved = Math.max(drag.moved, net);
  if (drag.moved <= PANEL_TAP_SLOP) return 0;
  // Crossing the slop hands over the whole turn so far (no lost motion), then each step.
  const delta = wasDrag ? step : wrap(yaw - drag.start);
  if (delta !== 0) drag.panel.onDrag(delta);
  return delta;
}

/**
 * Ends a drag: a tap selects; a drag tells the panel it ended. Returns true for a tap. A button
 * (no `onDrag`) is always a tap on release.
 */
export function endDrag(drag: PanelDrag): boolean {
  if (!drag.panel.onDrag || drag.moved <= PANEL_TAP_SLOP) {
    drag.panel.onSelect?.(drag.hit);
    return true;
  }
  drag.panel.onDragEnd?.();
  return false;
}

/**
 * Registers a mesh as a panel while mounted. Handlers are read through a ref, so changing them
 * never re-registers. Returns the ref callback to put on the mesh.
 */
export function useHoloPanel(
  registry: PanelRegistry | undefined,
  id: string,
  handlers: HoloPanelHandlers
) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const objectRef = useRef<THREE.Object3D | null>(null);
  const setRef = useCallback(
    (object: THREE.Object3D | null) => {
      if (objectRef.current) registry?.remove(objectRef.current);
      objectRef.current = object;
      if (!object) return;
      const data: HoloPanelData = {
        id,
        onSelect: (hit) => handlersRef.current.onSelect?.(hit),
        onDrag: (dx) => handlersRef.current.onDrag?.(dx),
        onDragEnd: () => handlersRef.current.onDragEnd?.(),
      };
      if (!handlersRef.current.onDrag) delete data.onDrag;
      object.userData[HOLO_PANEL_KEY] = data;
      registry?.add(object);
    },
    [registry, id]
  );
  useEffect(
    () => () => {
      if (objectRef.current) registry?.remove(objectRef.current);
    },
    [registry]
  );
  return setRef;
}
