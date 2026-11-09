'use client';

import { useMemo } from 'react';
import { Instance, Instances, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { FeederSceneModel, LineFlowSceneModel, SectorPole } from '../types';
import type { SectorId } from '@mitsinjo/engine';
import { POLE_HEIGHT, mapPolesToSectors, routeCable } from '../utils/cable-route';
import { STREET_LAMP_HEX, TOKEN_HEX, glowFromIntensity } from '../utils/scene-palette';
import { ElectronFlow } from './electron-flow';

export interface DistributionLinesProps {
  lines: {
    solarToBattery: LineFlowSceneModel;
    batteryToBus: LineFlowSceneModel;
    busToSectors: Record<string, LineFlowSceneModel>;
    /** Appliance derivations from tap points (PI-T7). */
    applianceDerivations?: LineFlowSceneModel[];
    /** Derivation utility poles mapped to their sector feeder (PI-T7). */
    appliancePoles?: SectorPole[];
  };
  /** Sector dispatch feeders to modulate street lamps per sector line (PL-T10). */
  feeders?: Record<SectorId, FeederSceneModel>;
  /** False under reduced motion or a modified scenario: electrons freeze in place. */
  animate?: boolean;
  /** Street-lamp brightness from the sky palette (night → 1). */
  lampGlow?: number;
  /** Wide glow layer under active cables (high tier only: one extra draw per line). */
  halo?: boolean;
}

interface SingleLineProps {
  line: LineFlowSceneModel;
  halo: boolean;
}

/** Static cable: dark conductor, plus a lit core when current flows (motion = ElectronFlow). */
function TransmissionCable({ line, halo }: SingleLineProps) {
  // Cable hops over utility poles with a sag in each span (pure routing util).
  const points = useMemo(
    () => routeCable(line.from, line.to).points.map((p) => new THREE.Vector3(...p)),
    [line.from, line.to]
  );

  // Brighter than 1 + toneMapped off → the bloom pass makes active cables glow.
  const glowColor = useMemo(
    () => new THREE.Color(line.color || '#50d8e8').multiplyScalar(1.6),
    [line.color]
  );

  // Red break mark at the cable midpoint when the sector is isolated by fire (M2-T3).
  const cutMid = line.cut ? points[Math.floor(points.length / 2)] : undefined;

  return (
    <group>
      {/* Physical utility cable, always visible (a cut line stays dark). */}
      <Line points={points} color="#2a2f36" lineWidth={1.4} />

      {cutMid && (
        <mesh position={cutMid} name="cut-mark">
          <octahedronGeometry args={[0.32, 0]} />
          <meshBasicMaterial color={TOKEN_HEX.criticalRed} toneMapped={false} />
        </mesh>
      )}

      {line.active && (
        <>
          {/* Wide aura under powered cables, high tier only (one extra draw). */}
          {halo && (
            <Line
              points={points}
              color={glowColor}
              lineWidth={5}
              transparent
              opacity={0.22}
              toneMapped={false}
            />
          )}
          <Line
            points={points}
            color={glowColor}
            lineWidth={1.8}
            transparent
            opacity={0.85}
            toneMapped={false}
          />
        </>
      )}
    </group>
  );
}

export function DistributionLines({
  lines,
  feeders,
  animate = true,
  lampGlow = 0.5,
  halo = true,
}: DistributionLinesProps) {
  const allLines = useMemo(() => {
    const list: LineFlowSceneModel[] = [
      lines.solarToBattery,
      lines.batteryToBus,
      ...Object.values(lines.busToSectors),
      ...(lines.applianceDerivations ?? []),
    ];
    return list;
  }, [lines]);

  // Utility poles mapped to the sector feeder that powers them (PL-T10)
  const mappedPoles = useMemo(() => mapPolesToSectors(lines), [lines]);

  // Instanced lamp colors: lights follow feeder intensity (faint glow in survival, 0 when cut).
  // Trunk poles (no feeder) stay lit while the bus is energized.
  const poleLampColors = useMemo(() => {
    const trunkIntensity = lines.batteryToBus.active ? 1 : 0;
    return mappedPoles.map((p) => {
      const intensity =
        p.sectorId != null
          ? (feeders?.[p.sectorId]?.intensity ?? (lines.busToSectors[p.sectorId]?.active ? 1 : 0))
          : trunkIntensity;

      if (intensity <= 0) {
        return new THREE.Color(0, 0, 0);
      }
      const glow = glowFromIntensity(intensity);
      return new THREE.Color(STREET_LAMP_HEX).multiplyScalar((0.4 + lampGlow * 2.2) * glow);
    });
  }, [mappedPoles, feeders, lines.busToSectors, lines.batteryToBus.active, lampGlow]);

  return (
    <group name="distribution-lines">
      {allLines.map((line, idx) => (
        <TransmissionCable key={idx} line={line} halo={halo} />
      ))}
      <ElectronFlow lines={allLines} animate={animate} />

      {/* Wooden utility poles, cross-arms, insulators and a street lamp on each */}
      <Instances limit={Math.max(1, mappedPoles.length)} name="pole-shafts" castShadow>
        <cylinderGeometry args={[0.06, 0.09, POLE_HEIGHT + 0.25, 7]} />
        <meshStandardMaterial color="#6b4c34" roughness={0.9} />
        {mappedPoles.map((p, i) => (
          <Instance key={i} position={[p.x, (POLE_HEIGHT + 0.25) / 2, p.z]} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, mappedPoles.length)} name="pole-arms" castShadow>
        <boxGeometry args={[0.8, 0.07, 0.07]} />
        <meshStandardMaterial color="#5a3f2b" roughness={0.9} />
        {mappedPoles.map((p, i) => (
          <Instance
            key={i}
            position={[p.x, POLE_HEIGHT + 0.05, p.z]}
            rotation={[0, (i * 1.3) % Math.PI, 0]}
          />
        ))}
      </Instances>
      {/* Ceramic bell insulators on the crossarms */}
      <Instances limit={Math.max(1, mappedPoles.length * 2)} name="pole-insulators">
        <cylinderGeometry args={[0.02, 0.035, 0.06, 6]} />
        <meshStandardMaterial color="#50b8b8" roughness={0.2} metalness={0.6} />
        {mappedPoles.flatMap((p, i) => {
          const rot = (i * 1.3) % Math.PI;
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          const y = POLE_HEIGHT + 0.11;
          return [
            <Instance key={`ins-l-${i}`} position={[p.x - 0.32 * cos, y, p.z + 0.32 * sin]} />,
            <Instance key={`ins-r-${i}`} position={[p.x + 0.32 * cos, y, p.z - 0.32 * sin]} />,
          ];
        })}
      </Instances>
      {/* Street lamp protective metal hood fixture */}
      <Instances limit={Math.max(1, mappedPoles.length)} name="pole-lamp-hoods">
        <coneGeometry args={[0.13, 0.06, 8, 1, true]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.4} />
        {mappedPoles.map((p, i) => (
          <Instance
            key={i}
            position={[p.x, POLE_HEIGHT - 0.31, p.z + 0.12]}
            rotation={[Math.PI, 0, 0]}
          />
        ))}
      </Instances>
      <Instances limit={Math.max(1, mappedPoles.length)} name="pole-lamps">
        <sphereGeometry args={[0.07, 8, 6]} />
        <meshBasicMaterial toneMapped={false} />
        {mappedPoles.map((p, i) => (
          <Instance
            key={i}
            position={[p.x, POLE_HEIGHT - 0.35, p.z + 0.12]}
            color={poleLampColors[i]}
          />
        ))}
      </Instances>
    </group>
  );
}
