'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import { holoCardTexture, HOLO, type HoloCardSpec } from './holo-style';
import { aimHint, aimHintKey, type AimHintContext } from './xr-aim-hint';
import type { AimReadout } from './xr-blaster-controller';

/** Hint card size (m) at 1 m; scaled with distance so it reads the same anywhere. */
const HINT_W = 0.3;
const HINT_H = 0.075;
/** Hint lifted above the beam end, as a fraction of its distance (≈ 4°). */
const HINT_LIFT = 0.07;

const _cam = new THREE.Vector3();

/**
 * « Trigger · Extract « Fridge » in 3D » next to each laser's end (VS-T23): what the select will do,
 * for controllers (trigger), hands (pinch) and the mouse (click). Text redrawn only when what is
 * aimed changes (cached canvas textures), positioned every frame without React renders.
 */
export const XrAimHint = memo(function XrAimHint({
  aim,
  context,
}: {
  aim: AimReadout;
  context: AimHintContext;
}) {
  const t = useTranslations('features.visionInsert.vrControls');
  const camera = useThree((s) => s.camera);
  const meshes = useMemo(
    () =>
      [0, 1].map(() => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(HINT_W, HINT_H),
          new THREE.MeshBasicMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        );
        m.renderOrder = 20;
        m.visible = false;
        m.name = 'xr-aim-hint';
        return m;
      }),
    []
  );
  useEffect(
    () => () =>
      meshes.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }),
    [meshes]
  );
  const keys = useRef<[string, string]>(['', '']);
  const live = useRef({ context, t });
  useEffect(() => {
    live.current = { context, t };
    keys.current = ['', '']; // context changed (names, state): rebuild the text
  }, [context, t]);

  useFrame(() => {
    camera.getWorldPosition(_cam);
    const { context: ctx, t: tr } = live.current;
    for (const i of [0, 1] as const) {
      const p = aim.pointers[i];
      const mesh = meshes[i]!;
      if (!p.visible) {
        mesh.visible = false;
        continue;
      }
      const key = aimHintKey(p, ctx);
      if (key !== keys.current[i]) {
        keys.current[i] = key;
        const hint = aimHint(p, ctx);
        const material = mesh.material as THREE.MeshBasicMaterial;
        if (!hint) material.map = null;
        else {
          const spec: HoloCardSpec = {
            width: 1024,
            height: 256,
            align: 'center',
            accent: HOLO.amber,
            lines: [
              { text: tr(hint.verb), size: 64, weight: 700, color: HOLO.amber },
              { text: tr(hint.action, hint.values ?? {}), size: 60, weight: 600 },
            ],
          };
          material.map = holoCardTexture(spec);
        }
        material.needsUpdate = true;
      }
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (!material.map) {
        mesh.visible = false;
        continue;
      }
      const dist = Math.max(0.3, Math.min(6, _cam.distanceTo(p.end)));
      mesh.position.copy(p.end);
      mesh.position.y += dist * HINT_LIFT;
      mesh.scale.setScalar(dist);
      mesh.lookAt(_cam);
      mesh.visible = true;
    }
  });

  return (
    <group name="xr-aim-hints">
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
});

/** Legend lines of one input, as i18n keys of `vrControls` (title first). */
export function legendKeys(kind: 'controller' | 'hand', handedness: XRHandedness): string[] {
  if (kind === 'hand') {
    return [
      'legendTitleHand',
      'legendPinch',
      'legendPad',
      'legendThumbTurn',
      'legendThumbTap',
      'legendWrist',
    ];
  }
  if (handedness === 'left') {
    return [
      'legendTitleLeft',
      'legendTrigger',
      'legendGrip',
      'legendStickWalk',
      'legendX',
      'legendY',
      'legendStickPress',
      'legendStickHold',
    ];
  }
  return [
    'legendTitleRight',
    'legendTrigger',
    'legendGrip',
    'legendStickTurn',
    'legendA',
    'legendB',
    'legendStickPress',
    'legendStickHold',
  ];
}

/** Legend card size (m), above each controller / hand. */
const LEGEND_W = 0.16;
const LEGEND_H = 0.12;

/**
 * Button legend on each controller (and each hand) (VS-T23, Meta: show what each button does on
 * the controller itself): shown on entry, toggled by a stick click or the menu. One canvas per
 * input kind, attached to the grip space so it moves with the controller.
 */
export const XrControlLegend = memo(function XrControlLegend({
  visible,
  namespace = 'features.visionInsert.vrControls',
  keysFor = legendKeys,
}: {
  visible: boolean;
  /** i18n namespace of the legend lines (/simulation has its own, VSIM-T1). */
  namespace?: string;
  /** Legend lines of one input, title first. */
  keysFor?: (kind: 'controller' | 'hand', handedness: XRHandedness) => string[];
}) {
  const t = useTranslations(namespace);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  const live = useRef({ t, keysFor });
  useEffect(() => {
    live.current = { t, keysFor };
  }, [t, keysFor]);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  useFrame(() => {
    for (const m of meshesRef.current) m.visible = visibleRef.current && !!m.userData.ready;
  });

  useEffect(() => {
    const getGrip = (gl.xr as unknown as { getControllerGrip?: (i: number) => THREE.Group })
      .getControllerGrip;
    if (typeof getGrip !== 'function' || !scene) return;
    const cards: Array<{ grip: THREE.Group; mesh: THREE.Mesh; onConnected: (e: unknown) => void }> =
      [];
    for (const i of [0, 1]) {
      const grip = getGrip.call(gl.xr, i);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(LEGEND_W, LEGEND_H),
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        })
      );
      mesh.name = 'xr-control-legend';
      mesh.renderOrder = 15;
      // Above the controller, leaning back toward the eyes.
      mesh.position.set(0, 0.11, 0.02);
      mesh.rotation.x = -0.6;
      mesh.visible = false;
      grip.add(mesh);
      // A grip already placed in a camera rig (/simulation) stays there; else it lives in the scene.
      if (!grip.parent) scene.add(grip);
      const draw = (source: XRInputSource) => {
        const kind = source.hand ? 'hand' : 'controller';
        const { t: tr, keysFor: keys } = live.current;
        const [title, ...rest] = keys(kind, source.handedness);
        (mesh.material as THREE.MeshBasicMaterial).map = holoCardTexture({
          width: 1024,
          height: 768,
          align: 'left',
          accent: HOLO.cyan,
          lines: [
            { text: tr(title!), size: 60, weight: 700, color: HOLO.cyan },
            ...rest.map((k) => ({ text: tr(k), size: 46, weight: 600 as const })),
          ],
        });
        (mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
        mesh.userData.ready = true;
      };
      const onConnected = (e: unknown) => {
        const source = (e as { data?: XRInputSource }).data;
        if (source) draw(source);
      };
      // Mounted after the session started: the inputs are already connected.
      const connected = gl.xr.getSession?.()?.inputSources?.[i];
      if (connected) draw(connected);
      (
        grip as unknown as THREE.EventDispatcher<{ connected: { data?: XRInputSource } }>
      ).addEventListener('connected', onConnected as never);
      cards.push({ grip, mesh, onConnected });
    }
    meshesRef.current = cards.map((c) => c.mesh);
    return () => {
      meshesRef.current = [];
      for (const c of cards) {
        (
          c.grip as unknown as THREE.EventDispatcher<{ connected: { data?: XRInputSource } }>
        ).removeEventListener('connected', c.onConnected as never);
        c.grip.remove(c.mesh);
        c.mesh.geometry.dispose();
        (c.mesh.material as THREE.Material).dispose();
      }
    };
  }, [gl, scene]);

  return null;
});
