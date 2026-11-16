import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createWristMenu } from '../wrist-menu';
import { createPanelRegistry, HOLO_PANEL_KEY } from '../holo-panel';
import { aimAt } from '../xr-blaster-controller';

vi.mock('../xr-audio-fx', () => ({
  playLaserShootSound: vi.fn(),
  playScanRadarSound: vi.fn(),
  playTargetHitSound: vi.fn(),
}));

/** A « Cancel » panel 1.5 m ahead, and the Menu button drifted right in front of it. */
function scene(wearer: 0 | 1 | null) {
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), new THREE.MeshBasicMaterial());
  panel.position.set(0, 1.4, -1.5);
  panel.userData[HOLO_PANEL_KEY] = { id: 'holo:extract-no' };
  panel.updateMatrixWorld();
  const panels = createPanelRegistry();
  panels.add(panel);
  const menu = createWristMenu(() => {});
  menu.buttonVisible = true;
  menu.wearer = wearer;
  menu.button.set(0, 1.4, -0.9);
  return { targets: [], menu, surface: null, hotspots: [], panels };
}

const origin = new THREE.Vector3(0, 1.4, 0);
const forward = new THREE.Vector3(0, 0, -1);

describe('aimAt: Menu button over a panel', () => {
  it('a floating Menu button drifted over a panel lets the panel take the shot', () => {
    const aim = aimAt(origin, forward, new THREE.Vector3(), scene(null));
    expect(aim.kind).toBe('panel');
    expect(aim.id).toBe('holo:extract-no');
  });

  it('a button worn on the wrist keeps priority', () => {
    const aim = aimAt(origin, forward, new THREE.Vector3(), scene(0));
    expect(aim.kind).toBe('wrist');
  });

  it('the floating button is still hit when no panel is behind it', () => {
    const s = scene(null);
    s.panels.objects.length = 0;
    expect(aimAt(origin, forward, new THREE.Vector3(), s).kind).toBe('wrist');
  });
});
