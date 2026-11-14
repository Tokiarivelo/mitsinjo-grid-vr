'use client';

import { useRef } from 'react';
import { Eye, EyeOff, Lock, LockOpen, RotateCcw, SquareDashed, Trash2 } from 'lucide-react';
import { RECIPE_MATERIALS } from '@/lib/object-shape';
import {
  editPiece,
  FULL_MASK,
  pieceBase,
  type PieceEdit,
  type PieceEdits,
  type PieceMask,
} from '@/lib/piece-edits';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Piece names with their own label (the rest are materials, or shown as they are). */
const PIECE_KEYS = new Set([
  'roof',
  'front',
  'right',
  'back',
  'left',
  'wall',
  'trim',
  'door',
  'base',
  'wall2',
  'roof2',
  'timber',
  'tyre',
  'rim',
  'under',
  'painted',
]);
const MATERIALS = new Set<string>(RECIPE_MATERIALS);

/** A piece's name in the page language (`glass-2` = the second window: « Glass 2 »). */
export function usePieceLabel() {
  const t = useTranslations('features.visionInsert');
  return (name: string) => {
    const { base, index } = pieceBase(name);
    const label = PIECE_KEYS.has(base)
      ? t(`studio.piece.${base}` as 'studio.piece.roof')
      : MATERIALS.has(base)
        ? t(`model3dMaterial.${base}` as 'model3dMaterial.stone')
        : base;
    return index === null ? label : t('studio.pieceItem', { piece: label, n: index });
  };
}

const AXES = ['x', 'y', 'z'] as const;

export interface PieceLayersPanelProps {
  names: readonly string[];
  edits: PieceEdits;
  selected: string | null;
  onSelect: (piece: string | null) => void;
  /** A step for undo (`from` = the edits before a slider drag). */
  onCommit: (next: PieceEdits, from?: PieceEdits) => void;
  /** A slider moving: no undo step yet. */
  onPreview: (next: PieceEdits) => void;
}

/**
 * « Layers » of the 3D Studio (PQ-T77): one row per piece (eye, lock, name, opacity) like an
 * image editor's layers; under the selected one its layer mask (a box in model shares, inverted
 * or not) and its numeric transform. Sliders preview while dragged and make one undo step when
 * released.
 */
export function PieceLayersPanel({
  names,
  edits,
  selected,
  onSelect,
  onCommit,
  onPreview,
}: PieceLayersPanelProps) {
  const t = useTranslations('features.visionInsert.studio');
  const label = usePieceLabel();
  const dragFrom = useRef<PieceEdits | null>(null);
  /** A slider moved: the first move remembers where the drag started. */
  const slide = (piece: string, patch: Partial<PieceEdit>) => {
    dragFrom.current ??= edits;
    onPreview(editPiece(edits, piece, patch));
  };
  const release = () => {
    if (!dragFrom.current) return;
    onCommit(edits, dragFrom.current);
    dragFrom.current = null;
  };
  const set = (piece: string, patch: Partial<PieceEdit> | null) =>
    onCommit(editPiece(edits, piece, patch));
  const sliderEnd = { onPointerUp: release, onKeyUp: release, onBlur: release };
  const edit = selected ? edits[selected] : undefined;

  return (
    <section aria-label={t('layers')} className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{t('layers')}</h3>
        <p className="text-xs text-text-muted">{t('layersHint')}</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {names.map((name) => {
          const e = edits[name];
          const on = selected === name;
          const piece = label(name);
          return (
            <li
              key={name}
              className={cn(
                'flex items-center gap-1 rounded-control border bg-surface px-1 py-0.5',
                on ? 'border-energy-cyan' : 'border-border'
              )}
            >
              <button
                type="button"
                aria-pressed={!e?.hidden}
                aria-label={t('visible', { piece })}
                onClick={() => set(name, { hidden: !e?.hidden })}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-text-secondary hover:bg-surface-hover"
              >
                {e?.hidden ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                aria-pressed={Boolean(e?.locked)}
                aria-label={t('lock', { piece })}
                onClick={() => set(name, { locked: !e?.locked })}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-text-secondary hover:bg-surface-hover"
              >
                {e?.locked ? (
                  <Lock className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <LockOpen className="h-4 w-4 opacity-50" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(on ? null : name)}
                className={cn(
                  'min-h-11 min-w-0 flex-1 truncate rounded-control px-2 text-left text-sm first-letter:uppercase',
                  on ? 'font-semibold text-text-primary' : 'text-text-secondary',
                  e?.hidden && 'line-through opacity-60'
                )}
              >
                {piece}
                {e?.mask && !e.mask.off && (
                  <SquareDashed
                    className="ml-1.5 inline h-3.5 w-3.5 text-energy-cyan"
                    aria-hidden="true"
                  />
                )}
              </button>
              <input
                type="range"
                min={5}
                max={100}
                value={Math.round((e?.opacity ?? 1) * 100)}
                aria-label={t('opacity', { piece })}
                onChange={(ev) => slide(name, { opacity: Number(ev.target.value) / 100 })}
                {...sliderEnd}
                className="h-11 w-20 shrink-0 accent-energy-cyan sm:w-24"
              />
            </li>
          );
        })}
      </ul>

      {!selected ? (
        <p className="rounded-control border border-dashed border-border p-3 text-xs text-text-muted">
          {t('noPiece')}
        </p>
      ) : (
        <>
          <MaskSection
            mask={edit?.mask}
            onAdd={() => set(selected, { mask: FULL_MASK })}
            onChange={(mask) => set(selected, { mask })}
            onSlide={(mask) => slide(selected, { mask })}
            onDelete={() => set(selected, { mask: undefined })}
            sliderEnd={sliderEnd}
          />
          <section className="flex flex-col gap-2 border-t border-border pt-3">
            <h4 className="text-xs font-semibold text-text-primary">{t('transform')}</h4>
            {edit?.locked && <p className="text-xs text-warning-amber">{t('locked')}</p>}
            {(
              [
                ['move', 'offset', 100, 0],
                ['rotate', 'rotation', 180 / Math.PI, 0],
                ['scale', 'scale', 1, 1],
              ] as const
            ).map(([key, field, unit, rest]) => (
              <fieldset
                key={key}
                className="grid grid-cols-[1fr_repeat(3,4.5rem)] items-center gap-1"
              >
                <legend className="sr-only">{t(key)}</legend>
                <span aria-hidden="true" className="text-xs text-text-secondary">
                  {t(key)}
                </span>
                {AXES.map((axis, i) => {
                  const v = edit?.[field]?.[i] ?? rest;
                  return (
                    <input
                      key={axis}
                      type="number"
                      step={key === 'scale' ? 0.05 : 1}
                      disabled={Boolean(edit?.locked)}
                      aria-label={`${t(key)} ${axis.toUpperCase()}`}
                      value={Number((v * unit).toFixed(2))}
                      onChange={(ev) => {
                        const n = Number(ev.target.value);
                        if (!Number.isFinite(n)) return;
                        const next = [...(edit?.[field] ?? [rest, rest, rest])] as [
                          number,
                          number,
                          number,
                        ];
                        next[i] = clampField(field, n / unit);
                        set(selected, { [field]: next });
                      }}
                      className="h-11 w-full rounded-control border border-border bg-canvas px-2 text-sm text-text-primary"
                    />
                  );
                })}
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() => set(selected, null)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-3 text-sm text-text-secondary hover:bg-surface-hover"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('resetPiece')}
            </button>
          </section>
        </>
      )}
    </section>
  );
}

/** The schema's bounds per field (`PieceEditSchema`). */
function clampField(field: 'offset' | 'rotation' | 'scale', v: number) {
  const [lo, hi] =
    field === 'offset' ? [-2, 2] : field === 'rotation' ? [-Math.PI, Math.PI] : [0.05, 5];
  return Math.max(lo, Math.min(hi, v));
}

function MaskSection({
  mask,
  onAdd,
  onChange,
  onSlide,
  onDelete,
  sliderEnd,
}: {
  mask: PieceMask | undefined;
  onAdd: () => void;
  onChange: (mask: PieceMask) => void;
  onSlide: (mask: PieceMask) => void;
  onDelete: () => void;
  sliderEnd: { onPointerUp: () => void; onKeyUp: () => void; onBlur: () => void };
}) {
  const t = useTranslations('features.visionInsert.studio');
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <h4 className="text-xs font-semibold text-text-primary">{t('mask')}</h4>
      <p className="text-xs text-text-muted">{t('maskHint')}</p>
      {!mask ? (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-energy-cyan/50 bg-energy-cyan/10 px-3 text-sm font-medium text-text-primary hover:bg-energy-cyan/20"
        >
          <SquareDashed className="h-4 w-4" aria-hidden="true" />
          {t('maskAdd')}
        </button>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={!mask.off}
                onChange={(e) => onChange({ ...mask, off: !e.target.checked })}
                className="h-5 w-5 accent-energy-cyan"
              />
              {t('maskOn')}
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={Boolean(mask.invert)}
                onChange={(e) => onChange({ ...mask, invert: e.target.checked })}
                className="h-5 w-5 accent-energy-cyan"
              />
              {t('maskInvert')}
            </label>
          </div>
          {AXES.map((axis, i) => (
            <div key={axis} className="grid grid-cols-2 gap-2">
              {(['maskMin', 'maskMax'] as const).map((end, j) => {
                const k = i * 2 + j;
                const name = t(end, { axis: t(`axis.${axis}`) });
                return (
                  <label key={end} className="flex flex-col text-[11px] text-text-muted">
                    {name}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(mask.box[k]! * 100)}
                      aria-label={name}
                      onChange={(e) => {
                        const box = [...mask.box] as PieceMask['box'];
                        const v = Number(e.target.value) / 100;
                        // min never past max: the box keeps its order.
                        box[k] = j === 0 ? Math.min(v, box[k + 1]!) : Math.max(v, box[k - 1]!);
                        onSlide({ ...mask, box });
                      }}
                      {...sliderEnd}
                      className="h-11 w-full accent-energy-cyan"
                    />
                  </label>
                );
              })}
            </div>
          ))}
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-3 text-sm text-text-secondary hover:bg-surface-hover"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('maskDelete')}
          </button>
        </>
      )}
    </section>
  );
}
