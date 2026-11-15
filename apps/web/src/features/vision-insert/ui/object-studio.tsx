'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box,
  Crosshair,
  Eye,
  EyeOff,
  Focus,
  Grid3x3,
  Move,
  MousePointer2,
  Redo2,
  RotateCcw,
  Rotate3d,
  Scale3d,
  ScanEye,
  Undo2,
  Video,
  X,
} from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import { editPiece, isolatePiece, type PieceEdits } from '@/lib/piece-edits';
import type { ObjectShape } from '@/lib/object-shape';
import type { ApplianceDetection } from '@/lib/vision';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { usePieceHistory } from '../hooks/use-piece-history';
import {
  CAMERA_KEYS,
  CAMERA_VIEWS,
  STUDIO_TOOLS,
  TOOL_KEYS,
  VIEW_MODES,
  type CameraRequest,
  type CameraView,
  type StudioControls,
  type StudioTool,
  type ViewMode,
} from '../utils/studio';
import { LazyObjectEditor3d } from './lazy-object-editor-3d';
import { PieceLayersPanel } from './piece-layers-panel';

const TOOL_ICON: Record<StudioTool, typeof Move> = {
  select: MousePointer2,
  move: Move,
  rotate: Rotate3d,
  scale: Scale3d,
};
const VIEW_ICON: Record<ViewMode, typeof Move> = {
  textured: Box,
  solid: Box,
  wireframe: Grid3x3,
  xray: ScanEye,
};

export interface ObjectStudioProps {
  shape: ObjectShape;
  detection: ApplianceDetection;
  label: string;
  imageUrl: string;
  /** Every edit, at once: the recipe keeps it (village, Blender). */
  onChange: (pieces: PieceEdits) => void;
  onClose: () => void;
}

/** Keys typed in a field are the field's, not the studio's. */
const typing = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement &&
  (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));

/**
 * 3D Studio (PQ-T77): the generated model full screen, edited piece by piece like Blender
 * (select / move / rotate / scale with a gizmo, view modes, camera presets, hide, isolate,
 * undo) and masked like Photoshop layers (eye, lock, opacity, a box mask per piece). Every edit
 * goes to the recipe at once (`onChange`). Esc closes; the browser goes full screen when allowed.
 */
export function ObjectStudio({
  shape,
  detection,
  label,
  imageUrl,
  onChange,
  onClose,
}: ObjectStudioProps) {
  const t = useTranslations('features.visionInsert.studio');
  const tCommon = useTranslations('common');
  const history = usePieceHistory(shape.recipe?.pieces);
  const { edits } = history;
  const [tool, setTool] = useState<StudioTool>('select');
  const [viewMode, setViewMode] = useState<ViewMode>('textured');
  const [camera, setCamera] = useState<CameraRequest>({ view: 'persp', n: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [grid, setGrid] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Every change goes to the recipe (the first render is the recipe's own edits).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange(edits);
  }, [edits, onChange]);

  const look = useCallback(
    (view: CameraView | 'frame') => setCamera((c) => ({ view, n: c.n + 1 })),
    []
  );
  const commit = history.commit;
  const hideSelected = useCallback(() => {
    if (selected) commit(editPiece(edits, selected, { hidden: true }));
    setSelected(null);
  }, [selected, edits, commit]);
  const showAll = useCallback(() => {
    let next = edits;
    for (const n of names) next = editPiece(next, n, { hidden: false });
    commit(next);
  }, [edits, names, commit]);
  const isolate = useCallback(() => {
    if (selected) commit(isolatePiece(edits, names, selected));
  }, [selected, edits, names, commit]);

  // Browser full screen when allowed (a refusal keeps the overlay); Esc closes either way.
  useEffect(() => {
    const el = rootRef.current;
    if (el?.requestFullscreen && !document.fullscreenElement)
      el.requestFullscreen().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') return onClose();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        return e.shiftKey ? history.redo() : history.undo();
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        return history.redo();
      }
      if (e.ctrlKey || e.metaKey) return;
      const toolKey = STUDIO_TOOLS.find((x) => TOOL_KEYS[x] === k);
      if (toolKey) return setTool(toolKey);
      const view = CAMERA_KEYS[e.key];
      if (view) return look(view);
      if (k === 'f') return look('frame');
      if (k === 'h') return e.altKey ? showAll() : hideSelected();
      if (e.key === '/') return isolate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, look, onClose, showAll, hideSelected, isolate]);

  const studio = useMemo<StudioControls>(
    () => ({
      tool,
      viewMode,
      camera,
      selected,
      grid,
      onSelect: setSelected,
      onTransform: (piece, edit) => commit(editPiece(edits, piece, edit)),
      onPieces: setNames,
    }),
    [tool, viewMode, camera, selected, grid, commit, edits]
  );
  const shown = useMemo<ObjectShape>(
    () => (shape.recipe ? { ...shape, recipe: { ...shape.recipe, pieces: edits } } : shape),
    [shape, edits]
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('title', { label })}
      className="fixed inset-0 z-50 flex flex-col bg-canvas text-text-primary"
    >
      <header className="flex items-center gap-2 border-b border-border bg-canvas-raised px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t('title', { label })}</h2>
        <StatusBadge variant="simulated" size="sm" label={tCommon('simulatedData')} />
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="grid h-11 w-11 place-items-center rounded-control border border-border hover:bg-surface-hover"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <div
        role="toolbar"
        aria-label={t('toolbar')}
        className="flex items-center gap-1 overflow-x-auto border-b border-border bg-canvas-raised px-2 py-1 [-webkit-overflow-scrolling:touch]"
      >
        <Group label={t('toolbar')}>
          {STUDIO_TOOLS.map((x) => (
            <ToolButton
              key={x}
              icon={TOOL_ICON[x]}
              label={`${t(`tool.${x}`)} (${TOOL_KEYS[x].toUpperCase()})`}
              text={t(`tool.${x}`)}
              pressed={tool === x}
              onClick={() => setTool(x)}
            />
          ))}
        </Group>
        <Group label={t('viewGroup')}>
          {VIEW_MODES.map((v) => (
            <ToolButton
              key={v}
              icon={VIEW_ICON[v]}
              label={t(`view.${v}`)}
              text={t(`view.${v}`)}
              pressed={viewMode === v}
              onClick={() => setViewMode(v)}
            />
          ))}
        </Group>
        <Group label={t('cameraGroup')}>
          {CAMERA_VIEWS.map((v) => (
            <ToolButton
              key={v}
              icon={Video}
              label={t(`camera.${v}`)}
              text={t(`camera.${v}`)}
              onClick={() => look(v)}
            />
          ))}
          <ToolButton
            icon={Crosshair}
            label={`${t('camera.frame')} (F)`}
            text={t('camera.frame')}
            disabled={!selected}
            onClick={() => look('frame')}
          />
          <ToolButton
            icon={Grid3x3}
            label={t('grid')}
            text={t('grid')}
            pressed={grid}
            onClick={() => setGrid((g) => !g)}
          />
        </Group>
        <Group label={t('layers')}>
          <ToolButton
            icon={EyeOff}
            label={`${t('hide')} (H)`}
            text={t('hide')}
            disabled={!selected}
            onClick={hideSelected}
          />
          <ToolButton
            icon={Eye}
            label={`${t('showAll')} (Alt+H)`}
            text={t('showAll')}
            onClick={showAll}
          />
          <ToolButton
            icon={Focus}
            label={`${t('isolate')} (/)`}
            text={t('isolate')}
            disabled={!selected}
            onClick={isolate}
          />
        </Group>
        <Group label={t('undo')}>
          <ToolButton
            icon={Undo2}
            label={`${t('undo')} (Ctrl+Z)`}
            text={t('undo')}
            disabled={!history.canUndo}
            onClick={history.undo}
          />
          <ToolButton
            icon={Redo2}
            label={`${t('redo')} (Ctrl+Shift+Z)`}
            text={t('redo')}
            disabled={!history.canRedo}
            onClick={history.redo}
          />
          <ToolButton
            icon={RotateCcw}
            label={t('resetAll')}
            text={t('resetAll')}
            disabled={!Object.keys(edits).length}
            onClick={() => commit({})}
          />
        </Group>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="viewer-studio relative min-h-[50vh] flex-1 lg:min-h-0">
          <LazyObjectEditor3d
            shape={shown}
            detection={detection}
            imageUrl={imageUrl}
            studio={studio}
          />
          <p className="pointer-events-none absolute bottom-2 left-2 right-2 hidden text-[11px] text-text-muted md:block">
            {t('keys')}
          </p>
        </div>
        <aside className="max-h-[45vh] overflow-y-auto border-t border-border bg-canvas-raised p-3 pb-20 md:pb-6 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
          <PieceLayersPanel
            names={names}
            edits={edits}
            selected={selected}
            onSelect={setSelected}
            onCommit={history.commit}
            onPreview={history.preview}
          />
          <p className="mt-3 text-[11px] text-text-muted">{t('kept')}</p>
        </aside>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 border-r border-border pr-1 last:border-r-0"
    >
      {children}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  text,
  pressed,
  disabled,
  onClick,
}: {
  icon: typeof Move;
  label: string;
  text: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-control px-2 text-xs',
        pressed
          ? 'bg-energy-cyan/15 text-text-primary ring-1 ring-energy-cyan'
          : 'text-text-secondary hover:bg-surface-hover',
        'disabled:pointer-events-none disabled:opacity-40'
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="hidden xl:inline">{text}</span>
    </button>
  );
}
