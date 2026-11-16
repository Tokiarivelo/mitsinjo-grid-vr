'use client';

import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { bandLevels, logBands } from '@/features/copilot/utils/spectrum';
import { VOICE_METER_BARS, voiceBar } from '../../utils/voice-meter';
import { HoloFrame, HoloText } from './holo-ui';
import {
  HOLO,
  HOLO_TEXT_DMM,
  HOLO_VIEW_DISTANCE,
  holoTextPx,
  type HoloCardSpec,
} from './holo-style';

type Vec3 = [number, number, number];

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export interface HoloVoiceMeterProps {
  /** Live microphone analyser; null = flat bars (mic not open yet). */
  analyser: AnalyserNode | null;
  width: number;
  height: number;
  position?: Vec3;
  /** Caption over the bars (« Voice level »). */
  title?: string;
  /** Distance (m) it is read from: sets the caption size in dmm. */
  distance?: number;
}

/** Share of the meter height the caption takes when there is one. */
const TITLE_SHARE = 0.36;

/**
 * Voice level meter of the VR chat (VS-T29): amber bars, one per band of the microphone spectrum
 * (80 Hz → 8 kHz, log axis, same bands as the copilot's spectrum), rising with the voice. One
 * instanced mesh, matrices written in the frame loop (no React render, no allocation per frame).
 */
export const HoloVoiceMeter = memo(function HoloVoiceMeter({
  analyser,
  width,
  height,
  position,
  title,
  distance = HOLO_VIEW_DISTANCE,
}: HoloVoiceMeterProps) {
  const bands = useMemo(() => logBands(VOICE_METER_BARS), []);
  const bins = useMemo(() => new Uint8Array(analyser?.frequencyBinCount ?? 0), [analyser]);
  const levels = useMemo(() => new Float32Array(VOICE_METER_BARS), []);
  const bars = useRef<THREE.InstancedMesh>(null);
  const innerW = width * 0.94;
  const barsH = title ? height * (1 - TITLE_SHARE) : height;
  const innerH = barsH * 0.8;
  const barsY = title ? -height / 2 + barsH / 2 : 0;
  const caption = useMemo<HoloCardSpec | null>(
    () =>
      title
        ? {
            glass: false,
            accent: HOLO.amber,
            lines: [
              {
                text: title,
                size: holoTextPx(HOLO_TEXT_DMM.caption, innerW, distance),
                weight: 600,
                color: HOLO.amber,
              },
            ],
          }
        : null,
    [title, innerW, distance]
  );
  const barW = (innerW / VOICE_METER_BARS) * 0.7;

  useFrame(() => {
    const m = bars.current;
    if (!(m instanceof THREE.InstancedMesh)) return;
    if (analyser && bins.length) {
      analyser.getByteFrequencyData(bins);
      bandLevels(bins, analyser.context.sampleRate, bands, levels);
    } else levels.fill(0);
    for (let i = 0; i < VOICE_METER_BARS; i++) {
      const b = voiceBar(i, VOICE_METER_BARS, innerW, innerH, levels[i]!);
      m.setMatrixAt(i, _m.compose(_p.set(b.x, b.y, 0.002), _q, _s.set(barW, b.h, 1)));
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={position} name="holo-voice-meter">
      <HoloFrame width={width} height={height} color={HOLO.amber} active />
      {caption && (
        <HoloText
          spec={caption}
          width={innerW}
          height={height * TITLE_SHARE}
          position={[0, height / 2 - (height * TITLE_SHARE) / 2, 0.002]}
        />
      )}
      <instancedMesh
        ref={bars}
        args={[undefined, undefined, VOICE_METER_BARS]}
        position={[0, barsY, 0]}
        renderOrder={4}
      >
        <planeGeometry />
        <meshBasicMaterial
          color={HOLO.amber}
          toneMapped={false}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  );
});
