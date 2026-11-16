'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { blinkAmount, gazeAngles } from '../../utils/lemur-bot';
import { HOLO, HOLO_BOT } from './holo-style';
import type { AimReadout } from './xr-blaster-controller';

type Vec3 = [number, number, number];

const BOT = HOLO_BOT;

const _target = new THREE.Vector3();

/**
 * Striped ring-tail curled over the head as an antenna: one tube, black / white bands from vertex
 * colours (one draw call), its tip a glowing light.
 */
function ringTailGeometry(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.012, 0.045, -0.01),
    new THREE.Vector3(0.04, 0.08, -0.015),
    new THREE.Vector3(0.075, 0.085, -0.01),
    new THREE.Vector3(0.09, 0.06, -0.005),
  ]);
  const tubular = 40;
  const radial = 8;
  const geo = new THREE.TubeGeometry(curve, tubular, 0.008, radial, false);
  const colors: number[] = [];
  const white = new THREE.Color(BOT.muzzle);
  const black = new THREE.Color(BOT.mask);
  for (let i = 0; i <= tubular; i++) {
    const c = Math.floor((i / tubular) * 8) % 2 === 0 ? black : white;
    for (let j = 0; j <= radial; j++) colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

export interface LemurBotProps {
  position: Vec3;
  /** Head radius (m). */
  size?: number;
  /** Live aim of the pointers: the head follows the cursor; none visible → looks at the viewer. */
  aim?: AimReadout;
  /** Working on a request: antenna light turns amber and pulses, ears twitch. */
  busy?: boolean;
}

/**
 * The chat's maki bot (VS-T27): a robot ring-tailed lemur head that turns toward the laser
 * cursor (eyes first, head after, both eased), blinks on a fixed irregular rhythm and bobs a little.
 * ~11 draw calls, Lambert / basic materials, no allocation per frame.
 */
export const LemurBot = memo(function LemurBot({
  position,
  size = 0.07,
  aim,
  busy = false,
}: LemurBotProps) {
  const camera = useThree((s) => s.camera);
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const pupils = useRef<THREE.Group>(null);
  const earL = useRef<THREE.Mesh>(null);
  const earR = useRef<THREE.Mesh>(null);
  const tip = useRef<THREE.MeshBasicMaterial>(null);
  const gaze = useRef({ yaw: 0, pitch: 0, eyeYaw: 0, eyePitch: 0 });
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const tail = useMemo(() => ringTailGeometry(), []);
  useEffect(() => () => tail.dispose(), [tail]);

  useFrame((state, delta) => {
    const g = root.current;
    const h = head.current;
    if (!g || !h) return;
    const t = state.clock.elapsedTime;
    // Target: a visible pointer's beam end, else the viewer's eyes.
    const p = aim?.pointers.find((x) => x.visible);
    if (p) _target.copy(p.end);
    else camera.getWorldPosition(_target);
    g.worldToLocal(_target);
    const want = gazeAngles(_target.x, _target.y, _target.z);
    const s = gaze.current;
    const ease = (k: number) => Math.min(1, delta * k);
    s.yaw += (want.yaw - s.yaw) * ease(4);
    s.pitch += (want.pitch - s.pitch) * ease(4);
    s.eyeYaw += (want.yaw - s.eyeYaw) * ease(14);
    s.eyePitch += (want.pitch - s.eyePitch) * ease(14);
    h.rotation.set(-s.pitch, s.yaw, Math.sin(t * 0.9) * 0.05);
    h.position.y = Math.sin(t * 1.6) * size * 0.08;
    // Pupils lead the head: the part of the turn the head has not made yet.
    pupils.current?.position.set(
      (s.eyeYaw - s.yaw) * size * 0.35,
      (s.eyePitch - s.pitch) * size * 0.35,
      0
    );
    eyes.current?.scale.set(1, Math.max(0.08, 1 - blinkAmount(t)), 1);
    const twitch = busyRef.current ? Math.sin(t * 18) * 0.12 : 0;
    if (earL.current) earL.current.rotation.z = 0.5 + twitch;
    if (earR.current) earR.current.rotation.z = -0.5 - twitch;
    if (tip.current) {
      tip.current.color.set(busyRef.current ? HOLO.amber : HOLO.violet);
      tip.current.opacity = busyRef.current ? 0.6 + 0.4 * Math.sin(t * 8) : 1;
    }
  });

  const r = size;
  const eyeX = r * 0.42;
  const eyeY = r * 0.12;
  const eyeZ = r * 0.8;
  return (
    <group ref={root} position={position} name="lemur-bot">
      <group ref={head}>
        {/* Head shell, a little wide like a lemur's */}
        <mesh scale={[1.1, 0.95, 0.95]}>
          <sphereGeometry args={[r, 24, 18]} />
          <meshLambertMaterial color={BOT.shell} emissive={HOLO.violet} emissiveIntensity={0.08} />
        </mesh>
        {/* White muzzle, pointing forward */}
        <mesh position={[0, -r * 0.32, r * 0.72]} scale={[0.62, 0.48, 0.7]}>
          <sphereGeometry args={[r, 16, 12]} />
          <meshLambertMaterial color={BOT.muzzle} />
        </mesh>
        <mesh position={[0, -r * 0.2, r * 1.2]}>
          <sphereGeometry args={[r * 0.11, 10, 8]} />
          <meshBasicMaterial color={BOT.mask} />
        </mesh>
        {/* Black eye mask, then the glowing eyes, blinking (scale Y) */}
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * eyeX, eyeY, eyeZ * 0.93]}
            scale={[1, 1.15, 0.45]}
            rotation={[0, 0, side * -0.35]}
          >
            <sphereGeometry args={[r * 0.36, 14, 10]} />
            <meshBasicMaterial color={BOT.mask} />
          </mesh>
        ))}
        <group ref={eyes} position={[0, eyeY, 0]}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * eyeX, 0, eyeZ]}>
              <sphereGeometry args={[r * 0.26, 16, 12]} />
              <meshBasicMaterial color={BOT.eye} toneMapped={false} />
            </mesh>
          ))}
          <group ref={pupils}>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * eyeX, 0, eyeZ + r * 0.22]}>
                <sphereGeometry args={[r * 0.11, 10, 8]} />
                <meshBasicMaterial color={BOT.pupil} />
              </mesh>
            ))}
          </group>
        </group>
        {/* Pointed ears, angled out */}
        <mesh ref={earL} position={[-r * 0.78, r * 0.72, -r * 0.1]} rotation={[0, 0, 0.5]}>
          <coneGeometry args={[r * 0.3, r * 0.62, 12]} />
          <meshLambertMaterial color={BOT.shell} />
        </mesh>
        <mesh ref={earR} position={[r * 0.78, r * 0.72, -r * 0.1]} rotation={[0, 0, -0.5]}>
          <coneGeometry args={[r * 0.3, r * 0.62, 12]} />
          <meshLambertMaterial color={BOT.shell} />
        </mesh>
        {/* Ring-tail antenna and its light */}
        <group position={[0, r * 0.88, -r * 0.2]} scale={r / 0.07}>
          <mesh geometry={tail}>
            <meshLambertMaterial vertexColors />
          </mesh>
          <mesh position={[0.09, 0.06, -0.005]}>
            <sphereGeometry args={[0.012, 10, 8]} />
            <meshBasicMaterial ref={tip} color={HOLO.violet} transparent toneMapped={false} />
          </mesh>
        </group>
      </group>
      {/* Holo ring under the head */}
      <mesh position={[0, -r * 1.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 0.75, r * 0.04, 6, 32]} />
        <meshBasicMaterial color={HOLO.violet} transparent opacity={0.7} toneMapped={false} />
      </mesh>
    </group>
  );
});
