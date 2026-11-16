'use client';

import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import { editPiece, type PieceEdits } from '@/lib/piece-edits';
import type { ObjectShape } from '@/lib/object-shape';
import type { ApplianceDetection } from '@/lib/vision';
import { usePieceHistory } from '../../hooks/use-piece-history';
import { VIEW_MODES, type StudioControls, type ViewMode } from '../../utils/studio';
import {
  clampScroll,
  LAB_PAGE,
  LAB_ROW,
  LAB_SCROLL_GAIN,
  labRotate,
  labScale,
  nextOpacity,
  rowShown,
} from '../../utils/xr-lab';
import { ObjectModel } from '../object-editor-3d';
import { usePieceLabel } from '../piece-layers-panel';
import { useHoloPanel, type PanelRegistry } from './holo-panel';
import { HoloButton, HoloFrame, HoloText } from './holo-ui';
import { HOLO } from './holo-style';
import { AnchoredPanel, usePanelAnchor } from './holo-extract-panels';
import { PEDESTAL_DROP, StudioPedestal } from './xr-extract-studio';
import type { PanelAnchor } from './xr-layout';
import { HoloVillageTable } from './holo-village-table';
import type { AimReadout } from './xr-blaster-controller';

export const LAB_IDS = {
  model: 'holo:lab-model',
  exit: 'holo:lab-exit',
  undo: 'holo:lab-undo',
  redo: 'holo:lab-redo',
  hide: 'holo:lab-hide',
  showAll: 'holo:lab-show-all',
  bigger: 'holo:lab-bigger',
  smaller: 'holo:lab-smaller',
  turn: 'holo:lab-turn',
  fade: 'holo:lab-fade',
  reset: 'holo:lab-reset',
  pageUp: 'holo:lab-page-up',
  pageDown: 'holo:lab-page-down',
  piece: (name: string) => `holo:lab-piece-${name}`,
  view: (mode: ViewMode) => `holo:lab-view-${mode}`,
} as const;

/** Largest side of the model on the lab pedestal (m): a table-top object, held at arm's length. */
const LAB_MODEL_SCALE = 0.55;
/** Model turn per radian of pointer drag. */
const TURN_GAIN = 3;
const NOOP = () => {};

export interface XrObjectLabProps {
  shape: ObjectShape;
  detection: ApplianceDetection;
  imageUrl: string;
  label: string;
  registry: PanelRegistry;
  hoveredId: string | null;
  /** Every edit, at once (the page's recipe: the 2D panel and the village see it live). */
  onEditPieces: (pieces: PieceEdits) => void;
  onExit: () => void;
  /** Where the studio opened (the model lands where its hologram stood); else ahead of the gaze. */
  anchor?: PanelAnchor | null;
  /** `photoKey` of the scanned photo: with it, the village hologram places the object (VS-T28). */
  photo?: string;
  /** Live pointer aim (the village table's cursor). */
  aim?: AimReadout;
}

/**
 * Immersive 3D lab (VS-T22), inside the studio room (`StudioRoom`, VS-T24), with the built model
 * 1 m ahead on its pedestal. Drag the model to turn it, shoot a piece to select it
 * (or pick it in the list on the left); the tools on the right hide it, size it, turn it, fade
 * it, switch the view mode, undo / redo. Every edit goes to the recipe at once (`onEditPieces`),
 * as in the page's 3D Studio (same history, same piece edits).
 */
export const XrObjectLab = memo(function XrObjectLab({
  shape,
  detection,
  imageUrl,
  label,
  registry,
  hoveredId,
  onEditPieces,
  onExit,
  anchor: studioAnchor,
  photo,
  aim,
}: XrObjectLabProps) {
  const t = useTranslations('features.visionInsert');
  const pieceLabel = usePieceLabel();
  const ownAnchor = usePanelAnchor(studioAnchor ? null : 'lab');
  const anchor = studioAnchor ?? ownAnchor;
  const history = usePieceHistory(shape.recipe?.pieces);
  const { edits, commit } = history;
  const [selected, setSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('textured');
  const [names, setNames] = useState<string[]>([]);
  /** List scroll (rows): live in a ref while dragged, settled in state (arrows) on release. */
  const [scroll, setScroll] = useState(0);
  const scrollRef = useRef(0);
  const listRef = useRef<THREE.Group>(null);
  const rowRefs = useRef<Array<THREE.Group | null>>([]);
  const turn = useRef<THREE.Group>(null);
  const yaw = useRef(0);

  // Every change goes to the recipe (the first render is the recipe's own edits).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onEditPieces(edits);
  }, [edits, onEditPieces]);

  // Dev only: lets `make vr-probe` read the lab (pieces, selection, hidden ones).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __VR_LAB__?: unknown };
    w.__VR_LAB__ = {
      names,
      selected,
      hidden: names.filter((n) => edits[n]?.hidden),
      viewMode,
    };
    return () => {
      delete w.__VR_LAB__;
    };
  }, [names, selected, edits, viewMode]);

  const shown = useMemo(
    () => (shape.recipe ? { ...shape, recipe: { ...shape.recipe, pieces: edits } } : shape),
    [shape, edits]
  );
  const studio = useMemo<StudioControls>(
    () => ({
      tool: 'select',
      viewMode,
      camera: { view: 'persp', n: 0 },
      selected,
      grid: false,
      onSelect: setSelected,
      onTransform: NOOP,
      onPieces: setNames,
    }),
    [viewMode, selected]
  );

  const modelRef = useHoloPanel(registry, LAB_IDS.model, {
    // The mesh under the ray is the piece (pieces are named meshes).
    onSelect: (hit) => {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (!names.includes(o.name)) continue;
        if (!edits[o.name]?.locked) setSelected(o.name);
        return;
      }
    },
    onDrag: (dx) => {
      yaw.current += dx * TURN_GAIN;
    },
  });
  useFrame(() => {
    if (turn.current) turn.current.rotation.y = yaw.current;
    // The list slides with the drag; rows outside its window hide (and take no ray).
    if (listRef.current) listRef.current.position.y = scrollRef.current * LAB_ROW;
    rowRefs.current.forEach((row, i) => {
      if (row) row.visible = rowShown(i, scrollRef.current);
    });
  });
  const scrollTo = (rows: number) => {
    scrollRef.current = clampScroll(rows, names.length);
    setScroll(scrollRef.current);
  };
  const listDrag = {
    axis: 'y' as const,
    onDrag: (dy: number) => {
      scrollRef.current = clampScroll(scrollRef.current + dy * LAB_SCROLL_GAIN, names.length);
    },
    onDragEnd: () => scrollTo(Math.round(scrollRef.current)),
  };

  const edit = selected ? edits[selected] : undefined;
  const apply = (patch: Parameters<typeof editPiece>[2]) => {
    if (selected) commit(editPiece(edits, selected, patch));
  };
  const showAll = () => {
    let next = edits;
    for (const n of names) next = editPiece(next, n, { hidden: false });
    commit(next);
  };

  const header = useMemo(
    () => ({
      glass: false,
      lines: [
        { text: t('vrLab.title', { name: label }), size: 60, weight: 700 as const },
        { text: t('vrLab.hint'), size: 36, weight: 400 as const, color: HOLO.cyan },
      ],
    }),
    [t, label]
  );
  const selectedSpec = useMemo(
    () => ({
      glass: false,
      lines: [
        {
          text: selected ? t('vrLab.selected', { piece: pieceLabel(selected) }) : t('vrLab.none'),
          size: 44,
          weight: 700 as const,
          color: selected ? HOLO.amber : HOLO.ink,
        },
        { text: t('vrLab.live'), size: 32, weight: 400 as const, color: HOLO.green },
      ],
    }),
    [t, selected, pieceLabel]
  );

  if (!anchor) return null;
  const btn = (id: string) => ({ registry, id, hovered: hoveredId === id });
  return (
    <group name="xr-object-lab">
      {/* The room (dome, grid, lights) is the studio's: `StudioRoom`, drawn by the studio. */}
      <AnchoredPanel anchor={anchor} name="xr-lab-panels">
        <HoloText spec={header} width={0.9} height={0.13} position={[0, 0.36, 0]} />

        {/* Pedestal + model */}
        <group position={[0, -PEDESTAL_DROP, 0]}>
          <StudioPedestal />
          <group ref={turn}>
            <group ref={modelRef} position={[0, LAB_MODEL_SCALE * 0.5, 0]}>
              <Suspense fallback={null}>
                <ObjectModel
                  shape={shown}
                  detection={detection}
                  imageUrl={imageUrl}
                  scale={LAB_MODEL_SCALE}
                  studio={studio}
                  xr
                />
              </Suspense>
            </group>
          </group>
        </group>

        {/* Pieces list (left, turned toward the viewer) */}
        <group position={[-0.62, 0, 0.2]} rotation={[0, 0.5, 0]}>
          <HoloFrame width={0.34} height={0.66} />
          <HoloText
            spec={{ glass: false, lines: [{ text: t('studio.layers'), size: 64, weight: 700 }] }}
            width={0.3}
            height={0.06}
            position={[0, 0.29, 0.003]}
          />
          {/* Every piece; pinch-and-drag up / down scrolls (a tap still selects) */}
          <group ref={listRef}>
            {names.map((name, i) => (
              <group
                key={name}
                ref={(g) => {
                  rowRefs.current[i] = g;
                }}
                visible={rowShown(i, scroll)}
              >
                <HoloButton
                  {...btn(LAB_IDS.piece(name))}
                  {...listDrag}
                  label={pieceLabel(name)}
                  sub={edits[name]?.hidden ? t('vrLab.hidden') : undefined}
                  width={0.3}
                  height={0.062}
                  position={[0, 0.215 - i * LAB_ROW, 0.004]}
                  on={selected === name}
                  color={edits[name]?.hidden ? HOLO.red : HOLO.cyan}
                  onSelect={() => setSelected(name)}
                />
              </group>
            ))}
          </group>
          <HoloButton
            {...btn(LAB_IDS.pageUp)}
            label="▲"
            width={0.14}
            height={0.06}
            position={[-0.075, -0.29, 0.004]}
            disabled={scroll <= 0}
            onSelect={() => scrollTo(scroll - (LAB_PAGE - 1))}
          />
          <HoloButton
            {...btn(LAB_IDS.pageDown)}
            label="▼"
            width={0.14}
            height={0.06}
            position={[0.075, -0.29, 0.004]}
            disabled={scroll >= clampScroll(Infinity, names.length)}
            onSelect={() => scrollTo(scroll + (LAB_PAGE - 1))}
          />
        </group>

        {/* Tools (right, turned toward the viewer) */}
        <group position={[0.62, 0, 0.2]} rotation={[0, -0.5, 0]}>
          <HoloFrame width={0.38} height={0.66} />
          <HoloText spec={selectedSpec} width={0.34} height={0.1} position={[0, 0.27, 0.003]} />
          <HoloButton
            {...btn(LAB_IDS.hide)}
            label={t('studio.hide')}
            width={0.16}
            height={0.07}
            position={[-0.09, 0.15, 0.004]}
            disabled={!selected}
            onSelect={() => {
              apply({ hidden: true });
              setSelected(null);
            }}
          />
          <HoloButton
            {...btn(LAB_IDS.showAll)}
            label={t('studio.showAll')}
            width={0.16}
            height={0.07}
            position={[0.09, 0.15, 0.004]}
            onSelect={showAll}
          />
          <HoloButton
            {...btn(LAB_IDS.smaller)}
            label={t('vrLab.smaller')}
            width={0.16}
            height={0.07}
            position={[-0.09, 0.07, 0.004]}
            disabled={!selected}
            onSelect={() => apply({ scale: labScale(edit, 1 / 1.15) })}
          />
          <HoloButton
            {...btn(LAB_IDS.bigger)}
            label={t('vrLab.bigger')}
            width={0.16}
            height={0.07}
            position={[0.09, 0.07, 0.004]}
            disabled={!selected}
            onSelect={() => apply({ scale: labScale(edit, 1.15) })}
          />
          <HoloButton
            {...btn(LAB_IDS.turn)}
            label={t('vrLab.turn')}
            width={0.16}
            height={0.07}
            position={[-0.09, -0.01, 0.004]}
            disabled={!selected}
            onSelect={() => apply({ rotation: labRotate(edit) })}
          />
          <HoloButton
            {...btn(LAB_IDS.fade)}
            label={t('vrLab.fade')}
            width={0.16}
            height={0.07}
            position={[0.09, -0.01, 0.004]}
            disabled={!selected}
            onSelect={() => apply({ opacity: nextOpacity(edit?.opacity) })}
          />
          {VIEW_MODES.map((mode, i) => (
            <HoloButton
              key={mode}
              {...btn(LAB_IDS.view(mode))}
              label={t(`studio.view.${mode}`)}
              width={0.085}
              height={0.06}
              position={[-0.135 + i * 0.09, -0.09, 0.004]}
              on={viewMode === mode}
              onSelect={() => setViewMode(mode)}
            />
          ))}
          <HoloButton
            {...btn(LAB_IDS.undo)}
            label={t('studio.undo')}
            width={0.11}
            height={0.07}
            position={[-0.12, -0.17, 0.004]}
            disabled={!history.canUndo}
            onSelect={history.undo}
          />
          <HoloButton
            {...btn(LAB_IDS.redo)}
            label={t('studio.redo')}
            width={0.11}
            height={0.07}
            position={[0, -0.17, 0.004]}
            disabled={!history.canRedo}
            onSelect={history.redo}
          />
          <HoloButton
            {...btn(LAB_IDS.reset)}
            label={t('studio.resetPiece')}
            width={0.11}
            height={0.07}
            position={[0.12, -0.17, 0.004]}
            disabled={!selected || !edit}
            onSelect={() => {
              if (selected) commit(editPiece(edits, selected, null));
            }}
          />
          <HoloButton
            {...btn(LAB_IDS.exit)}
            label={t('vrLab.exit')}
            width={0.34}
            height={0.075}
            position={[0, -0.27, 0.004]}
            color={HOLO.amber}
            onSelect={onExit}
          />
        </group>

        {/* Village hologram (VS-T28): place the edited model, add it, go to the simulation */}
        {photo && (
          <HoloVillageTable
            registry={registry}
            hoveredId={hoveredId}
            detection={detection}
            name={label}
            photo={photo}
            recipe={shown.mode === 'recipe' ? (shown.recipe ?? null) : null}
            {...(aim ? { aim } : {})}
          />
        )}
      </AnchoredPanel>
    </group>
  );
});
