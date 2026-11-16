'use client';

import { memo, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import type { Priority, SectorId } from '@mitsinjo/engine';
import { useTranslations } from '@/lib/i18n';
import { fmtKw, fmtPct } from '@/lib/format';
import type { SceneModel } from '../types';
import {
  BATTERY_POSITION,
  BUS_POSITION,
  SECTOR_POSITIONS,
  SOLAR_POSITION,
} from '../utils/site-positions';
import {
  getAirOptionTexture,
  getVillageTypeTagTexture,
  type VillageTypeTextureSpec,
} from '../utils/immersion-labels-texture';

export interface ImmersionLabelsProps {
  model: SceneModel;
  selectedSector: SectorId | null;
  onSelectSector: (sector: SectorId | null) => void;
  sectorNames: Record<SectorId, string>;
  priorityLabels: Record<Priority, string>;
  /** WebXR presenting in headset or emulator. */
  xrActive?: boolean;
  /** Floating option position in the air [x, y, z]. Default [0, 3.6, 9.5]. */
  airOptionPosition?: [number, number, number];
  /** Controlled active state (optional). */
  showLabels?: boolean;
  /** Controlled toggle callback (optional). */
  onToggleLabels?: () => void;
  /** The dispatcher's label was selected (VR: its mixing desk, VS-T34). */
  onSelectDispatcher?: () => void;
}

/** One 3D tag: its card, the stalk's foot (`basePos`) and the card's centre (`anchorPos`). */
export interface ImmersionTagItem extends VillageTypeTextureSpec {
  anchorPos: [number, number, number];
  basePos: [number, number, number];
  sectorId?: SectorId;
}
type VillageTypeItem = ImmersionTagItem;

/** Accent per sector on the 3D tags: a sector's buildings and its inserted objects share it. */
export const SECTOR_TAG_ACCENT: Record<SectorId, string> = {
  households: '#38bdf8',
  school: '#f59e0b',
  water: '#06b6d4',
  market: '#eab308',
  health: '#ef4444',
  industry: '#8b5cf6',
};

/**
 * 3D Floating Interactive Option in the air (Hologram Console Beacon).
 * Suspended gracefully in the air above the entrance path to the village.
 * Clicking toggles the tagged labels of each village type in 3D.
 */
export const AirOptionBeacon = memo(function AirOptionBeacon({
  active,
  onToggle,
  position = [0, 3.6, 9.5],
}: {
  active: boolean;
  onToggle: () => void;
  position?: [number, number, number];
}) {
  const tSim = useTranslations('features.simulation');
  const [hovered, setHovered] = useState(false);
  const [pulseScale, setPulseScale] = useState(0);

  const groupRef = useRef<THREE.Group>(null);
  const crystalRef = useRef<THREE.Mesh>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const pulseRingRef = useRef<THREE.Mesh>(null);

  const texts = useMemo(
    () => ({
      title: tSim('airLabelsToggle'),
      stateText: active ? tSim('airLabelsActive') : tSim('airLabelsHidden'),
      hint: active ? tSim('airLabelsHintHide') : tSim('airLabelsHintShow'),
    }),
    [tSim, active]
  );

  const texture = useMemo(
    () => getAirOptionTexture(active, hovered, texts),
    [active, hovered, texts]
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // 1. Gentle floating bobbing in the air
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(t * 1.8) * 0.08;
    }

    // 2. Spinning central crystal
    if (crystalRef.current) {
      crystalRef.current.rotation.y += delta * (hovered ? 3.0 : 1.4);
      crystalRef.current.rotation.x = Math.sin(t * 1.5) * 0.25;
    }

    // 3. Counter-rotating concentric holographic rings
    if (ring1Ref.current) {
      ring1Ref.current.rotation.z += delta * 1.2;
      ring1Ref.current.rotation.x = Math.sin(t * 0.9) * 0.4;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.z -= delta * 1.6;
      ring2Ref.current.rotation.y = Math.cos(t * 1.1) * 0.4;
    }

    // 4. Click ripple pulse ring expansion
    if (pulseRingRef.current && pulseScale > 0) {
      const nextScale = pulseScale + delta * 3.5;
      if (nextScale > 3.0) {
        setPulseScale(0);
        pulseRingRef.current.scale.set(0, 0, 0);
      } else {
        setPulseScale(nextScale);
        pulseRingRef.current.scale.set(nextScale, nextScale, 1);
        const mat = pulseRingRef.current.material as THREE.MeshBasicMaterial;
        if (mat) mat.opacity = Math.max(0, 1.0 - nextScale / 3.0);
      }
    }
  });

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setPulseScale(0.1);
    onToggle();
  };

  const accentColor = active ? '#38bdf8' : '#f59e0b';

  return (
    <group
      ref={groupRef}
      name="air-option-toggle"
      position={position}
      onClick={handleClick}
      userData={{ onSelect: () => onToggle() }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        if (typeof document !== 'undefined') document.body.style.cursor = 'auto';
      }}
    >
      {/* Central Holographic Crystal */}
      <mesh
        ref={crystalRef}
        position={[0, 0.42, 0]}
        castShadow
        userData={{ onSelect: () => onToggle() }}
      >
        <octahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={hovered ? 2.6 : 1.8}
          roughness={0.15}
          metalness={0.25}
          toneMapped={false}
        />
      </mesh>

      {/* Concentric Gyro Rings */}
      <mesh ref={ring1Ref} position={[0, 0.42, 0]}>
        <torusGeometry args={[0.36, 0.012, 8, 28]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.75} toneMapped={false} />
      </mesh>
      <mesh ref={ring2Ref} position={[0, 0.42, 0]}>
        <torusGeometry args={[0.27, 0.009, 8, 24]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.65} toneMapped={false} />
      </mesh>

      {/* Click ripple pulse ring */}
      <mesh ref={pulseRingRef} position={[0, 0.42, 0]} scale={[0, 0, 0]}>
        <ringGeometry args={[0.15, 0.22, 32]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.9} toneMapped={false} />
      </mesh>

      {/* Downward Light Pillar Beaming to Ground */}
      <mesh position={[0, -position[1] / 2, 0]}>
        <cylinderGeometry args={[0.02, 0.08, position[1], 12, 1, true]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.22} toneMapped={false} />
      </mesh>

      {/* Ground Projection Halo */}
      <mesh position={[0, -position[1] + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.35, 0.65, 32]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.4} toneMapped={false} />
      </mesh>

      {/* Interactive Floating Billboard Button */}
      <Billboard follow lockX={false} lockY={false} lockZ={false} position={[0, -0.22, 0]}>
        <mesh scale={hovered ? 1.08 : 1.0} userData={{ onSelect: () => onToggle() }}>
          <planeGeometry args={[1.65, 0.65]} />
          <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
});

/**
 * One 3D tag in immersion (village types and inserted objects, VS-T35): vertical laser stalk,
 * ground anchor pin and billboard card. `size` scales the card (a small object's tag is smaller).
 */
export const ImmersionTag = memo(function ImmersionTag({
  item,
  selected,
  onSelect,
  size = 1,
}: {
  item: ImmersionTagItem;
  selected: boolean;
  onSelect?: () => void;
  size?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const texture = useMemo(() => getVillageTypeTagTexture(item), [item]);

  const [bx, by, bz] = item.basePos;
  const [ax, ay, az] = item.anchorPos;
  const stalkHeight = Math.max(0.2, ay - by);
  const stalkCenterY = by + stalkHeight / 2;

  return (
    <group name={`vtag-${item.id}`}>
      {/* 1. Vertical Laser Stalk connecting roof/ground to badge */}
      <mesh position={[bx, stalkCenterY, bz]}>
        <cylinderGeometry args={[0.014, 0.014, stalkHeight, 8]} />
        <meshBasicMaterial color={item.accentColor} transparent opacity={0.65} toneMapped={false} />
      </mesh>

      {/* Base Anchor Dot */}
      <mesh position={[bx, by, bz]}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshBasicMaterial color={item.accentColor} toneMapped={false} />
      </mesh>

      {/* Base Anchor Ground Glow Ring */}
      <mesh position={[bx, by + 0.02, bz]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.32, 20]} />
        <meshBasicMaterial color={item.accentColor} transparent opacity={0.55} toneMapped={false} />
      </mesh>

      {/* 2. Facing Billboard 3D Tagged Badge */}
      <Billboard follow lockX={false} lockY={false} lockZ={false} position={[ax, ay, az]}>
        <mesh
          scale={size * (selected ? 1.15 : hovered ? 1.08 : 1.0)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          userData={{ onSelect: () => onSelect?.() }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            setHovered(false);
            if (typeof document !== 'undefined') document.body.style.cursor = 'auto';
          }}
        >
          <planeGeometry args={[2.5, 1.05]} />
          <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
});

/**
 * Renders the tagged labels of all 11 village types across the village digital twin.
 */
export const ImmersionLabels = memo(function ImmersionLabels({
  model,
  selectedSector,
  onSelectSector,
  sectorNames,
  priorityLabels,
  airOptionPosition = [0, 3.6, 9.5],
  showLabels,
  onToggleLabels,
  onSelectDispatcher,
}: ImmersionLabelsProps) {
  const tSim = useTranslations('features.simulation');
  const [internalActive, setInternalActive] = useState(false);
  const isControlled = showLabels !== undefined;
  const active = isControlled ? showLabels : internalActive;

  const toggle = () => {
    if (isControlled) {
      onToggleLabels?.();
    } else {
      setInternalActive((prev) => !prev);
    }
  };

  const villageTypeItems: VillageTypeItem[] = useMemo(() => {
    const hh = model.buildings.households;
    const sch = model.buildings.school;
    const wt = model.buildings.water;
    const mkt = model.buildings.market;
    const hl = model.buildings.health;
    const ind = model.buildings.industry;

    return [
      // 1. Village Households (Residential)
      {
        id: 'households',
        sectorId: 'households',
        title: sectorNames.households,
        category: tSim('villageTypes.residential'),
        description: `${priorityLabels[hh.priority]} · ${fmtPct(hh.coveragePct, 0)}`,
        icon: '🏠',
        accentColor: SECTOR_TAG_ACCENT.households,
        basePos: [SECTOR_POSITIONS.households[0], 1.6, SECTOR_POSITIONS.households[2]],
        anchorPos: [SECTOR_POSITIONS.households[0], 4.2, SECTOR_POSITIONS.households[2]],
      },
      // 2. Primary School (Education)
      {
        id: 'school',
        sectorId: 'school',
        title: sectorNames.school,
        category: tSim('villageTypes.education'),
        description: `${priorityLabels[sch.priority]} · ${fmtKw(sch.servedKw)}`,
        icon: '🏫',
        accentColor: SECTOR_TAG_ACCENT.school,
        basePos: [SECTOR_POSITIONS.school[0], 2.8, SECTOR_POSITIONS.school[2]],
        anchorPos: [SECTOR_POSITIONS.school[0], 5.2, SECTOR_POSITIONS.school[2]],
      },
      // 3. Water Pumping Station (Water & Sanitation)
      {
        id: 'water',
        sectorId: 'water',
        title: sectorNames.water,
        category: tSim('villageTypes.water'),
        description: `${priorityLabels[wt.priority]} · ${fmtKw(wt.servedKw)}`,
        icon: '💧',
        accentColor: SECTOR_TAG_ACCENT.water,
        basePos: [SECTOR_POSITIONS.water[0], 4.6, SECTOR_POSITIONS.water[2]],
        anchorPos: [SECTOR_POSITIONS.water[0], 6.8, SECTOR_POSITIONS.water[2]],
      },
      // 4. Local Market & Artisans (Commerce)
      {
        id: 'market',
        sectorId: 'market',
        title: sectorNames.market,
        category: tSim('villageTypes.commerce'),
        description: `${priorityLabels[mkt.priority]} · ${fmtKw(mkt.servedKw)}`,
        icon: '🛍️',
        accentColor: SECTOR_TAG_ACCENT.market,
        basePos: [SECTOR_POSITIONS.market[0], 1.8, SECTOR_POSITIONS.market[2]],
        anchorPos: [SECTOR_POSITIONS.market[0], 4.2, SECTOR_POSITIONS.market[2]],
      },
      // 5. Health Clinic (Healthcare Lifeline)
      {
        id: 'health',
        sectorId: 'health',
        title: sectorNames.health,
        category: tSim('villageTypes.healthcare'),
        description: `${priorityLabels[hl.priority]} · ${fmtKw(hl.servedKw)}`,
        icon: '🏥',
        accentColor: SECTOR_TAG_ACCENT.health,
        basePos: [SECTOR_POSITIONS.health[0], 3.4, SECTOR_POSITIONS.health[2]],
        anchorPos: [SECTOR_POSITIONS.health[0], 5.8, SECTOR_POSITIONS.health[2]],
      },
      // 6. Carpentry Workshop (Productive Industry)
      {
        id: 'industry',
        sectorId: 'industry',
        title: sectorNames.industry,
        category: tSim('villageTypes.industry'),
        description: `${priorityLabels[ind.priority]} · ${ind.connected ? fmtKw(ind.servedKw) : tSim('villageTags.standby')}`,
        icon: '🏭',
        accentColor: SECTOR_TAG_ACCENT.industry,
        basePos: [SECTOR_POSITIONS.industry[0], 2.4, SECTOR_POSITIONS.industry[2]],
        anchorPos: [SECTOR_POSITIONS.industry[0], 4.8, SECTOR_POSITIONS.industry[2]],
      },
      // 7. Solar PV Array (Clean Energy Generation)
      {
        id: 'solar',
        title: tSim('solarArray'),
        category: tSim('villageTypes.solar'),
        description: tSim('villageTags.solar', { kw: fmtKw(model.solar.currentKw) }),
        icon: '☀️',
        accentColor: '#f59e0b',
        basePos: [SOLAR_POSITION[0], 1.2, SOLAR_POSITION[2]],
        anchorPos: [SOLAR_POSITION[0], 3.8, SOLAR_POSITION[2]],
      },
      // 8. Central BESS Storage (Grid Storage)
      {
        id: 'battery',
        title: tSim('bessBattery'),
        category: tSim('villageTypes.battery'),
        description: tSim('villageTags.battery', { pct: fmtPct(model.battery.socPct, 0) }),
        icon: '🔋',
        accentColor: '#10b981',
        basePos: [BATTERY_POSITION[0], 1.4, BATTERY_POSITION[2]],
        anchorPos: [BATTERY_POSITION[0], 4.0, BATTERY_POSITION[2]],
      },
      // 9. EMS Dispatch Hub (Microgrid Core)
      {
        id: 'controller',
        title: tSim('villageTags.controllerTitle'),
        category: tSim('villageTypes.controller'),
        description: tSim('villageTags.controller'),
        icon: '⚡',
        accentColor: '#38bdf8',
        basePos: [BUS_POSITION[0], 1.8, BUS_POSITION[2]],
        anchorPos: [BUS_POSITION[0], 4.4, BUS_POSITION[2]],
      },
      // 10. Hilltop Wind Turbines (Wind Power)
      {
        id: 'wind',
        title: tSim('villageTags.windTitle'),
        category: tSim('villageTypes.wind'),
        description: tSim('villageTags.wind'),
        icon: '🌀',
        accentColor: '#0284c7',
        basePos: [22, 14.0, -58],
        anchorPos: [22, 20.0, -58],
      },
      // 11. Lake Promenade (Scenic Nature & Safety Grille)
      {
        id: 'lake',
        title: tSim('villageTags.lakeTitle'),
        category: tSim('villageTypes.lake'),
        description: tSim('villageTags.lake'),
        icon: '🌊',
        accentColor: '#06b6d4',
        basePos: [30, 0.6, -46],
        anchorPos: [30, 3.6, -46],
      },
    ];
  }, [model, sectorNames, priorityLabels, tSim]);

  return (
    <group name="immersion-labels-system">
      {/* 1. Floating Interactive Option in the air */}
      <AirOptionBeacon active={active} onToggle={toggle} position={airOptionPosition} />

      {/* 2. All 11 Tagged Labels of Village Types across the diorama */}
      {active &&
        villageTypeItems.map((item) => (
          <ImmersionTag
            key={item.id}
            item={item}
            selected={item.sectorId ? selectedSector === item.sectorId : false}
            onSelect={() => {
              if (item.sectorId) onSelectSector(item.sectorId);
              else if (item.id === 'controller') onSelectDispatcher?.();
            }}
          />
        ))}
    </group>
  );
});
