'use client';

import { Image as ImageIcon, Layers, MousePointerClick, RotateCcw } from 'lucide-react';
import { HULL_SURFACES, type HullSurface } from '@/lib/face-hull';
import { RECIPE_MATERIALS, type FaceSurface, type RecipeMaterial } from '@/lib/object-shape';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { surfaceColor } from '../utils/face-projection';

export interface SurfaceEditorProps {
  /** The operator's look per surface; a surface without an entry shows its drawing. */
  surfaces: Partial<Record<HullSurface, FaceSurface>>;
  selected: HullSurface | null;
  onSelect: (surface: HullSurface | null) => void;
  /** `look` null gives the surface back to its drawing (or to its `base` look). */
  onChange: (surface: HullSurface, look: FaceSurface | null) => void;
  /**
   * Look a surface has before the operator touches it, when it is not its drawing (PQ-T72: a
   * house's roof shows its specialist's covering). « Drawing » then asks for the drawing explicitly.
   */
  base?: Partial<Record<HullSurface, { material: RecipeMaterial; color: string }>>;
}

/** The look a surface shows: the operator's, else its base one (unless asked for the drawing). */
function shownLook(
  look: FaceSurface | undefined,
  base: { material: RecipeMaterial; color: string } | undefined
): FaceSurface | undefined {
  if (look?.drawing) return look.color ? { color: look.color } : undefined;
  if (look?.material || !base) return look;
  return { material: base.material, color: look?.color ?? base.color };
}

const FIELD =
  'min-h-11 rounded-control border border-border bg-surface-elevated px-2 text-xs text-text-primary cursor-pointer';

/**
 * Surface editor of a model that wears its drawings (PQ-T71): pick the roof or a wall (here or
 * by clicking the model), then keep its drawing, tint it, or replace it by a material in a colour.
 * Display of the model only: no energy value, no model call.
 */
export function SurfaceEditor({
  surfaces,
  selected,
  onSelect,
  onChange,
  base = {},
}: SurfaceEditorProps) {
  const t = useTranslations('features.visionInsert');
  const own = selected ? surfaces[selected] : undefined;
  const look = selected ? shownLook(own, base[selected]) : undefined;
  const material = look?.material;
  const shown = surfaceColor(look);

  return (
    <section
      aria-label={t('surfaceEditorTitle')}
      className="flex flex-col gap-2 rounded-control border border-border bg-canvas-sunken p-3"
    >
      <div>
        <h5 className="text-xs font-semibold text-text-primary">{t('surfaceEditorTitle')}</h5>
        <p className="flex items-start gap-1.5 text-[11px] text-text-muted">
          <MousePointerClick className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {t('surfaceEditorHint')}
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label={t('surfaceEditorPick')}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {HULL_SURFACES.map((name) => {
          const active = selected === name;
          const dot = surfaceColor(shownLook(surfaces[name], base[name]));
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(active ? null : name)}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium cursor-pointer transition-colors',
                active
                  ? 'border-energy-cyan bg-energy-cyan/10 text-text-primary'
                  : 'border-border bg-surface-elevated text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              )}
            >
              {dot ? (
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full border border-border-strong"
                  style={{ backgroundColor: dot }}
                />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
              )}
              {t(`surfaceName.${name}`)}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <div
            role="group"
            aria-label={t('surfaceSource')}
            className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1"
          >
            {(['drawing', 'material'] as const).map((mode) => {
              const on = (mode === 'material') === Boolean(material);
              const Icon = mode === 'drawing' ? ImageIcon : Layers;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange(
                      selected,
                      mode === 'material'
                        ? { material: material ?? DEFAULT_MATERIAL[selected] }
                        : base[selected]
                          ? { drawing: true }
                          : null
                    )
                  }
                  className={cn(
                    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium cursor-pointer transition-colors',
                    on
                      ? 'bg-surface-elevated text-text-primary shadow-xs'
                      : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {t(`surfaceMode.${mode}`)}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {material && (
              <label className="flex min-h-11 flex-1 basis-40 items-center gap-2 text-xs text-text-secondary">
                {t('surfaceMaterial')}
                <select
                  value={material}
                  onChange={(e) => {
                    const next = e.target.value as RecipeMaterial;
                    // A colour the operator chose stays; the default one follows the material.
                    onChange(selected, {
                      material: next,
                      ...(look?.color ? { color: look.color } : {}),
                    });
                  }}
                  className={cn(FIELD, 'flex-1')}
                >
                  {RECIPE_MATERIALS.map((m) => (
                    <option key={m} value={m}>
                      {t(`model3dMaterial.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex min-h-11 items-center gap-2 text-xs text-text-secondary">
              {material ? t('surfaceColor') : t('surfaceTint')}
              <input
                type="color"
                value={shown ?? NO_TINT}
                onChange={(e) =>
                  onChange(selected, { ...(material ? { material } : {}), color: e.target.value })
                }
                className="h-8 w-11 cursor-pointer rounded-control border border-border bg-surface-elevated p-0.5"
              />
            </label>
            {own && (
              <button
                type="button"
                onClick={() => onChange(selected, null)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 text-xs font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('surfaceReset')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Tint shown by the colour field while the drawing is untouched (white = no tint). */
const NO_TINT = '#ffffff';

/** Material offered first when a surface leaves its drawing. */
const DEFAULT_MATERIAL: Record<HullSurface, RecipeMaterial> = {
  roof: 'tile',
  front: 'plaster',
  right: 'plaster',
  back: 'plaster',
  left: 'plaster',
};
