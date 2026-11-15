'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { TOKEN_HEX } from '@/features/microgrid-3d/utils/scene-palette';
import type { PieceEdit, PieceEdits } from '@/lib/piece-edits';
import {
  maskPlanes,
  modelBox,
  pieceTransform,
  splitPieces,
  type ModelBox,
  type ModelPiece,
} from '../utils/model-pieces';
import {
  CAMERA_DIRECTION,
  GIZMO_MODE,
  STUDIO_CLAY_HEX,
  XRAY_OPACITY,
  type StudioControls,
  type ViewMode,
} from '../utils/studio';

/** Pointer travel (px) past which a click was an orbit drag. */
const PICK_MAX_DRAG = 4;
/** Studio camera distance for a 1 × 1 × 1 model (presets and « frame »). */
export const STUDIO_DISTANCE = 2.6;

/**
 * A piece's material for the view: the model's own (shared) when nothing changes it; else a
 * copy with the view mode, the opacity and the layer mask (clipping planes). The caller disposes
 * the copies (`owned`).
 */
function pieceMaterial(
  base: THREE.Material,
  edit: PieceEdit | undefined,
  viewMode: ViewMode,
  box: ModelBox,
  scale: number
): { material: THREE.Material; owned: boolean } {
  const mask = maskPlanes(edit?.mask, box, scale);
  const opacity = viewMode === 'xray' ? XRAY_OPACITY : (edit?.opacity ?? 1);
  if (viewMode === 'textured' && !mask && opacity >= 1) return { material: base, owned: false };
  const m =
    viewMode === 'solid'
      ? new THREE.MeshStandardMaterial({ color: STUDIO_CLAY_HEX, roughness: 0.7, metalness: 0 })
      : base.clone();
  if (viewMode === 'wireframe' && 'wireframe' in m)
    (m as THREE.MeshStandardMaterial).wireframe = true;
  if (opacity < 1) {
    m.transparent = true;
    m.opacity = opacity;
    m.depthWrite = false;
  }
  if (mask) {
    m.clippingPlanes = mask.planes;
    m.clipIntersection = mask.intersection;
    m.side = THREE.DoubleSide; // a cut piece shows its inside, not a hole
  }
  return { material: m, owned: true };
}

function Piece({
  piece,
  edit,
  base,
  box,
  scale,
  studio,
  onPick,
}: {
  piece: ModelPiece;
  edit: PieceEdit | undefined;
  base: THREE.Material;
  box: ModelBox;
  scale: number;
  studio?: StudioControls;
  onPick?: (piece: ModelPiece) => void;
}) {
  const viewMode = studio?.viewMode ?? 'textured';
  const { material, owned } = useMemo(
    () => pieceMaterial(base, edit, viewMode, box, scale),
    [base, edit, viewMode, box, scale]
  );
  useEffect(() => () => void (owned && material.dispose()), [material, owned]);
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const t = pieceTransform(edit, piece.center, box);
  const selected = studio?.selected === piece.name;
  const gizmo = selected && studio && studio.tool !== 'select' && !edit?.locked;
  const invalidate = useThree((s) => s.invalidate);
  return (
    <>
      <mesh
        ref={setMesh}
        name={piece.name}
        geometry={piece.geometry}
        material={material}
        position={t.position}
        rotation={t.rotation}
        scale={t.scale}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.delta > PICK_MAX_DRAG) return;
          e.stopPropagation();
          onPick?.(piece);
        }}
      >
        {selected && <Edges threshold={30} color={TOKEN_HEX.energyCyan} />}
      </mesh>
      {gizmo && mesh && (
        <TransformControls
          object={mesh}
          mode={GIZMO_MODE[studio.tool as keyof typeof GIZMO_MODE]}
          size={0.8}
          onObjectChange={() => invalidate()}
          onMouseUp={() => {
            const p = mesh.position;
            studio.onTransform(piece.name, {
              offset: [
                clampShare((p.x - piece.center[0]) / box.size[0]),
                clampShare((p.y - piece.center[1]) / box.size[1]),
                clampShare((p.z - piece.center[2]) / box.size[2]),
              ],
              rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(wrapAngle) as [
                number,
                number,
                number,
              ],
              scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z].map(clampScale) as [
                number,
                number,
                number,
              ],
            });
          }}
        />
      )}
    </>
  );
}

const clampShare = (v: number) => Math.max(-2, Math.min(2, v));
const clampScale = (v: number) => Math.max(0.05, Math.min(5, Math.abs(v)));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Moves the camera on a preset or onto the selected piece (« frame selected »). */
function StudioCamera({
  studio,
  pieces,
  box,
  scale,
}: {
  studio: StudioControls;
  pieces: ModelPiece[];
  box: ModelBox;
  scale: number;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree(
    (s) => s.controls as unknown as { target: THREE.Vector3; update: () => void } | null
  );
  const invalidate = useThree((s) => s.invalidate);
  const last = useRef(-1);
  useEffect(() => {
    const req = studio.camera;
    if (req.n === last.current) return;
    last.current = req.n;
    const target = new THREE.Vector3();
    let dist = STUDIO_DISTANCE * Math.max(...box.size) * scale;
    let dir = new THREE.Vector3().subVectors(camera.position, controls?.target ?? target);
    if (req.view === 'frame') {
      const p = pieces.find((x) => x.name === studio.selected);
      if (p) {
        p.geometry.computeBoundingSphere();
        target.set(...p.center).multiplyScalar(scale);
        dist = Math.max(0.4, (p.geometry.boundingSphere?.radius ?? 0.5) * scale * 3.2);
      }
    } else {
      dir = new THREE.Vector3(...CAMERA_DIRECTION[req.view]);
    }
    camera.position.copy(target).add(dir.normalize().multiplyScalar(dist));
    camera.lookAt(target);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
    invalidate();
  }, [studio.camera, studio.selected, pieces, box, scale, camera, controls, invalidate]);
  return null;
}

export interface StudioPiecesProps {
  mesh: THREE.BufferGeometry;
  materials: ReadonlyArray<THREE.Material>;
  names: readonly string[];
  edits: PieceEdits | undefined;
  scale: number;
  studio?: StudioControls;
  /** Outside the studio, a click names the piece's slot (surface editor). */
  onPickSlot?: (slot: number) => void;
}

/**
 * The model drawn piece by piece (PQ-T77): one mesh per geometry group, centred on its pivot,
 * with its edits (hidden, faded, moved / turned / scaled, layer mask as clipping planes). In the
 * studio: pick, gizmo, view modes, camera presets, grid and axes.
 */
export function StudioPieces({
  mesh,
  materials,
  names,
  edits,
  scale,
  studio,
  onPickSlot,
}: StudioPiecesProps) {
  const pieces = useMemo(() => splitPieces(mesh, names), [mesh, names]);
  useEffect(() => () => pieces.forEach((p) => p.geometry.dispose()), [pieces]);
  const box = useMemo(() => modelBox(mesh), [mesh]);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  // Layer masks are clipping planes: on again whenever the edits change (the print wipe turns
  // local clipping off when a build ends).
  useEffect(() => {
    get().gl.localClippingEnabled = true;
    invalidate();
  }, [get, edits, invalidate]);
  const onPieces = studio?.onPieces;
  useEffect(() => onPieces?.(pieces.map((p) => p.name)), [pieces, onPieces]);
  useEffect(() => invalidate(), [edits, studio, invalidate]);
  const floorY = box.min[1] * scale - 0.002;
  return (
    <>
      <group scale={scale}>
        {pieces.map((p) =>
          edits?.[p.name]?.hidden ? null : (
            <Piece
              key={p.name}
              piece={p}
              edit={edits?.[p.name]}
              base={materials[p.slot] ?? materials[0]!}
              box={box}
              scale={scale}
              {...(studio ? { studio } : {})}
              onPick={(piece) => {
                if (studio) {
                  if (!edits?.[piece.name]?.locked) studio.onSelect(piece.name);
                } else onPickSlot?.(piece.slot);
              }}
            />
          )
        )}
      </group>
      {studio?.grid && (
        <>
          <gridHelper args={[6, 30, TOKEN_HEX.idle, TOKEN_HEX.idle]} position={[0, floorY, 0]} />
          <axesHelper args={[0.5]} position={[0, floorY + 0.001, 0]} />
        </>
      )}
      {studio && <StudioCamera studio={studio} pieces={pieces} box={box} scale={scale} />}
    </>
  );
}
