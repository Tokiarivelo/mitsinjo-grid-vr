'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useRouter } from 'next/navigation';
import { MAX_APPLIANCES } from '@mitsinjo/engine';
import { useTranslations } from '@/lib/i18n';
import { fmtKw, fmtKwh } from '@/lib/format';
import type { ObjectRecipe } from '@/lib/object-shape';
import type { ApplianceDetection } from '@/lib/vision';
import { useSiteZones } from '@/features/microgrid-3d/hooks/use-site-zones';
import {
  KEEP_OUT_ZONES,
  POND_CENTER,
  POND_RADIUS,
  VILLAGE_PATHS,
} from '@/features/microgrid-3d/utils/landscape';
import { tapPoint } from '@/features/microgrid-3d/utils/tap-point';
import { useApplianceInsert } from '../../hooks/use-appliance-insert';
import {
  pathSegmentsInRange,
  tableUvToVillage,
  villageToTable,
  VILLAGE_HOLO_RANGE,
} from '../../utils/village-holo';
import { useHoloPanel, type PanelRegistry } from './holo-panel';
import { HoloButton, HoloFrame, HoloText } from './holo-ui';
import { HOLO, type HoloCardSpec } from './holo-style';
import type { AimReadout } from './xr-blaster-controller';
import { VILLAGE_TABLE } from './xr-layout';

export const VILLAGE_IDS = {
  map: 'holo:village-map',
  insert: 'holo:village-insert',
  simulation: 'holo:village-simulation',
} as const;

const R = VILLAGE_TABLE.radius;
const K = R / VILLAGE_HOLO_RANGE;
/** Placed objects drawn at most (the simulation holds fewer lines). */
const MAX_DOTS = 48;
const STATIC_IDS = new Set(KEEP_OUT_ZONES.map((z) => z.id));

const _local = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export interface HoloVillageTableProps {
  registry: PanelRegistry;
  hoveredId: string | null;
  detection: ApplianceDetection;
  /** Object name in the page language. */
  name: string;
  /** `photoKey` of the scanned photo (the line id). */
  photo: string;
  /** The model as edited in the lab: it goes to the village with the line. */
  recipe: ObjectRecipe | null;
  /** Live pointer aim: the cursor ring on the table. */
  aim?: AimReadout;
}

/**
 * Village hologram of the VR lab (VS-T28): the village core as a round table (paths, pond,
 * buildings, the objects already placed), turned toward the viewer. Aim at the table and press to
 * place the object (the page's placement: snapped onto the terrain, out of buildings and paths,
 * nearest feeder), see its feeder cable, « Add to the simulation » (same call as the page: line +
 * edited 3D model, engine re-run), then « Go to the simulation » (leaves the headset session).
 */
export const HoloVillageTable = memo(function HoloVillageTable({
  registry,
  hoveredId,
  detection,
  name,
  photo,
  recipe,
  aim,
}: HoloVillageTableProps) {
  const t = useTranslations('features.visionInsert');
  const tSector = useTranslations('sectors');
  const router = useRouter();
  const gl = useThree((s) => s.gl);
  const { id, draft, inSimulation, full, insert } = useApplianceInsert({
    detection,
    name,
    photo,
    recipe,
  });
  const [added, setAdded] = useState(false);
  const pos = draft.draft.position;
  const sector = draft.draft.sector;
  const zones = useSiteZones();

  const table = useRef<THREE.Group>(null);
  const mapRef = useHoloPanel(registry, VILLAGE_IDS.map, {
    onSelect: (hit) => {
      if (!hit.uv) return;
      draft.setPosition(tableUvToVillage(hit.uv.x, hit.uv.y, R));
      setAdded(false);
    },
  });

  // Static geometry: paths (one line set), buildings (one instanced mesh).
  const paths = useMemo(() => {
    const seg = pathSegmentsInRange(VILLAGE_PATHS);
    const pts: number[] = [];
    for (let i = 0; i < seg.length; i += 4)
      pts.push(seg[i]! * K, 0.002, seg[i + 1]! * K, seg[i + 2]! * K, 0.002, seg[i + 3]! * K);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useEffect(() => () => paths.dispose(), [paths]);
  const buildings = useMemo(() => KEEP_OUT_ZONES.filter((z) => z.id !== 'pond'), []);
  const buildingsRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = buildingsRef.current;
    if (!(m instanceof THREE.InstancedMesh)) return; // not mounted in a three scene
    buildings.forEach((z, i) => {
      const w = z.r * 1.1 * K;
      const h = (z.id?.startsWith('sector:') ? 0.025 : 0.012) * (R / 0.32);
      const [x, tz] = villageToTable(z.x, z.z, R);
      m.setMatrixAt(i, _m.compose(_p.set(x, h / 2, tz), _q.identity(), _s.set(w, h, w)));
    });
    m.instanceMatrix.needsUpdate = true;
  }, [buildings]);

  // Objects already placed (other lines), as amber dots.
  const others = useMemo(
    () =>
      zones
        .filter((z) => z.id && !STATIC_IDS.has(z.id) && z.id !== id)
        .filter((z) => Math.hypot(z.x, z.z) <= VILLAGE_HOLO_RANGE)
        .slice(0, MAX_DOTS),
    [zones, id]
  );
  const dotsRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = dotsRef.current;
    if (!(m instanceof THREE.InstancedMesh)) return; // not mounted in a three scene
    others.forEach((z, i) => {
      const [x, tz] = villageToTable(z.x, z.z, R);
      const r = Math.max(0.006, z.r * K * 0.6);
      m.setMatrixAt(i, _m.compose(_p.set(x, 0.008, tz), _q.identity(), _s.set(r, 0.016, r)));
    });
    m.count = others.length;
    m.instanceMatrix.needsUpdate = true;
  }, [others]);

  // Feeder cable of the placed spot (the page's `tapPoint`).
  const cable = useMemo(() => {
    if (!pos) return null;
    const tap = tapPoint(pos, sector, draft.draft.connectionMode ?? 'branch', {
      zones,
      excludeId: id,
    });
    const pts = [tap.point, ...(tap.waypoint ? [tap.waypoint] : []), [pos.x, 0, pos.z]].flatMap(
      ([x, , z]) => [x! * K, 0.006, z! * K]
    );
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [pos, sector, draft.draft.connectionMode, zones, id]);
  useEffect(() => () => cable?.dispose(), [cable]);

  // Hover cursor on the table; the placed pin bobs a little.
  const cursor = useRef<THREE.Mesh>(null);
  const pin = useRef<THREE.Group>(null);
  const mapHovered = hoveredId === VILLAGE_IDS.map;
  useFrame((state) => {
    if (pin.current) pin.current.position.y = 0.035 + Math.sin(state.clock.elapsedTime * 3) * 0.006;
    const c = cursor.current;
    const g = table.current;
    if (!c || !g) return;
    const p = mapHovered ? aim?.pointers.find((x) => x.visible && x.id === VILLAGE_IDS.map) : null;
    c.visible = Boolean(p);
    if (!p) return;
    g.worldToLocal(_local.copy(p.end));
    c.position.set(_local.x, 0.004, _local.z);
  });

  const goSimulation = () => {
    // Leave the immersive session first: the next page starts in the browser view.
    void gl.xr
      .getSession()
      ?.end()
      .catch(() => {});
    router.push('/simulation');
  };

  const summary = draft.summary;
  const header = useMemo<HoloCardSpec>(
    () => ({
      glass: false,
      lines: [
        { text: t('vrVillage.title', { name }), size: 52, weight: 700 },
        { text: t('vrVillage.hint'), size: 34, weight: 400, color: HOLO.cyan },
      ],
    }),
    [t, name]
  );
  const status = useMemo<HoloCardSpec>(() => {
    const where = pos
      ? t('vrVillage.placed', {
          x: pos.x.toFixed(1),
          z: pos.z.toFixed(1),
          sector: tSector(sector),
        })
      : t('vrVillage.notPlaced');
    const engine = summary
      ? t('insertPreview', { peak: fmtKw(summary.peakKw, 2), daily: fmtKwh(summary.dailyKwh, 2) })
      : t('insertInvalid');
    const state = full
      ? t('insertFull', { max: MAX_APPLIANCES })
      : added || inSimulation
        ? t('vrVillage.inSimulation')
        : '';
    return {
      glass: false,
      lines: [
        { text: where, size: 38, weight: 600, color: pos ? HOLO.ink : HOLO.amber },
        { text: engine, size: 32, weight: 400, color: HOLO.cyan },
        ...(state
          ? [{ text: state, size: 34, weight: 600 as const, color: full ? HOLO.amber : HOLO.green }]
          : []),
      ],
    };
  }, [t, tSector, pos, sector, summary, full, added, inSimulation]);

  // Dev only: lets `make vr-probe` read the placement.
  const inSim = added || inSimulation;
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __VR_VILLAGE__?: unknown };
    w.__VR_VILLAGE__ = { position: pos, sector, inSimulation: inSim };
    return () => {
      delete w.__VR_VILLAGE__;
    };
  }, [pos, sector, inSim]);

  const canInsert = Boolean(pos && draft.appliance && !full);
  const tilt = VILLAGE_TABLE.tilt;
  return (
    <group
      position={VILLAGE_TABLE.position}
      rotation={[0, VILLAGE_TABLE.yaw, 0]}
      name="holo-village-table"
    >
      <HoloText
        spec={header}
        width={0.8}
        height={0.12}
        position={[0, R * Math.sin(tilt) + 0.12, -R * Math.cos(tilt)]}
      />
      <group ref={table} position={[0, 0, 0]} rotation={[tilt, 0, 0]}>
        {/* Table disc: the aim / tap surface */}
        <mesh ref={mapRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
          <circleGeometry args={[R, 48]} />
          <meshBasicMaterial
            color={HOLO.dome}
            transparent
            opacity={0.85}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} renderOrder={2}>
          <ringGeometry args={[R * 0.985, R, 64]} />
          <meshBasicMaterial color={HOLO.cyan} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <lineSegments geometry={paths} renderOrder={2}>
          <lineBasicMaterial color={HOLO.gridDim} toneMapped={false} />
        </lineSegments>
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[POND_CENTER[0] * K, 0.002, POND_CENTER[1] * K]}
          renderOrder={2}
        >
          <circleGeometry args={[POND_RADIUS * K, 20]} />
          <meshBasicMaterial color={HOLO.cyan} transparent opacity={0.5} toneMapped={false} />
        </mesh>
        <instancedMesh ref={buildingsRef} args={[undefined, undefined, buildings.length]}>
          <boxGeometry />
          <meshLambertMaterial color={HOLO.violet} emissive={HOLO.violet} emissiveIntensity={0.4} />
        </instancedMesh>
        <instancedMesh ref={dotsRef} args={[undefined, undefined, MAX_DOTS]}>
          <cylinderGeometry args={[1, 1, 1, 12]} />
          <meshBasicMaterial color={HOLO.amber} toneMapped={false} />
        </instancedMesh>
        {cable && (
          <line>
            <primitive object={cable} attach="geometry" />
            <lineBasicMaterial color={HOLO.cyan} toneMapped={false} />
          </line>
        )}
        {pos && (
          <group position={[pos.x * K, 0, pos.z * K]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
              <ringGeometry args={[0.012, 0.018, 24]} />
              <meshBasicMaterial color={HOLO.green} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            <group ref={pin}>
              <mesh rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[0.012, 0.03, 12]} />
                <meshBasicMaterial color={HOLO.green} toneMapped={false} />
              </mesh>
            </group>
          </group>
        )}
        <mesh ref={cursor} visible={false} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <ringGeometry args={[0.01, 0.015, 24]} />
          <meshBasicMaterial color={HOLO.ink} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Status and actions, just in front of and below the table's near edge */}
      <group position={[0, -R * Math.sin(tilt) - 0.15, R * Math.cos(tilt) + 0.02]}>
        <HoloFrame width={0.62} height={0.14} />
        <HoloText spec={status} width={0.6} height={0.13} position={[0, 0, 0.003]} />
        <HoloButton
          registry={registry}
          id={VILLAGE_IDS.insert}
          label={inSimulation || added ? t('insertUpdate') : t('insertButton')}
          width={0.34}
          height={0.08}
          position={[-0.14, -0.13, 0.004]}
          color={HOLO.green}
          disabled={!canInsert}
          hovered={hoveredId === VILLAGE_IDS.insert}
          onSelect={() => setAdded(insert())}
        />
        <HoloButton
          registry={registry}
          id={VILLAGE_IDS.simulation}
          label={t('vrVillage.goSimulation')}
          width={0.26}
          height={0.08}
          position={[0.18, -0.13, 0.004]}
          color={HOLO.cyan}
          disabled={!(added || inSimulation)}
          hovered={hoveredId === VILLAGE_IDS.simulation}
          onSelect={goSimulation}
        />
      </group>
    </group>
  );
});
