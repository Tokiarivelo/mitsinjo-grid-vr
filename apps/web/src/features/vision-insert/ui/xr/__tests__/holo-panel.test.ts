import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createPanelRegistry,
  dragTo,
  endDrag,
  HOLO_PANEL_KEY,
  PANEL_TAP_SLOP,
  panelOf,
  shown,
  type PanelDrag,
} from '../holo-panel';

const hit = (object: THREE.Object3D) =>
  ({ object, point: new THREE.Vector3(), distance: 1 }) as THREE.Intersection;

const dragOf = (panel: PanelDrag['panel']): PanelDrag => ({
  panel,
  hit: hit(new THREE.Mesh()),
  yaw: 0,
  moved: 0,
});

describe('holo panels (VS-T19)', () => {
  it('registers each object once and forgets it', () => {
    const r = createPanelRegistry();
    const o = new THREE.Object3D();
    r.add(o);
    r.add(o);
    expect(r.objects).toEqual([o]);
    r.remove(o);
    expect(r.objects).toEqual([]);
  });

  it('finds the panel of a child mesh (lab model pieces) and respects hidden parents', () => {
    const panel = new THREE.Group();
    panel.userData[HOLO_PANEL_KEY] = { id: 'holo:lab-model' };
    const piece = new THREE.Mesh();
    panel.add(piece);
    expect(panelOf(piece)?.id).toBe('holo:lab-model');
    expect(shown(piece)).toBe(true);
    panel.visible = false;
    expect(shown(piece)).toBe(false);
  });

  it('a select released without moving is a tap', () => {
    const onSelect = vi.fn();
    const onDrag = vi.fn();
    const drag = dragOf({ id: 'holo:x', onSelect, onDrag });
    dragTo(drag, PANEL_TAP_SLOP / 2);
    expect(onDrag).not.toHaveBeenCalled();
    expect(endDrag(drag)).toBe(true);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('a held select turned sideways drags (carousel), and is not a tap', () => {
    const onSelect = vi.fn();
    const onDrag = vi.fn();
    const onDragEnd = vi.fn();
    const drag = dragOf({ id: 'holo:x', onSelect, onDrag, onDragEnd });
    dragTo(drag, 0.1);
    expect(onDrag).toHaveBeenLastCalledWith(expect.closeTo(0.1, 5));
    dragTo(drag, 0.25);
    expect(onDrag).toHaveBeenLastCalledWith(expect.closeTo(0.15, 5));
    expect(endDrag(drag)).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDragEnd).toHaveBeenCalledOnce();
  });

  it('pinch drift and tremor (back and forth) never turn a tap into a drag', () => {
    // Regression: summed tremor passed 2° and « Extract in 3D » / « Cancel » did nothing.
    const onSelect = vi.fn();
    const onDrag = vi.fn();
    const drag = dragOf({ id: 'holo:x', onSelect, onDrag });
    for (let i = 0; i < 40; i++) dragTo(drag, i % 2 ? 0.02 : -0.02);
    expect(onDrag).not.toHaveBeenCalled();
    expect(endDrag(drag)).toBe(true);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('a button (no onDrag) is a tap on release however the ray moved', () => {
    const onSelect = vi.fn();
    const drag = dragOf({ id: 'holo:extract-yes', onSelect });
    dragTo(drag, 0.3);
    expect(endDrag(drag)).toBe(true);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
