'use client';

import { useId, useState } from 'react';
import { CheckCircle2, MapPin, PencilLine, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import {
  APPLIANCE_CATEGORIES,
  SECTOR_IDS,
  type ApplianceCategory,
  type SectorId,
} from '@mitsinjo/engine';
import { FIELD_CLASS } from '@/components/ui/field';
import { fmtKw, fmtKwh } from '@/lib/format';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { nearestSector } from '@/features/microgrid-3d/utils/placement';
import type { ApplianceDraftState } from '../hooks/use-appliance-draft';
import { ApplianceCurveChart } from './appliance-curve-chart';
import { PlaceMinimap } from './place-minimap';
import { useSiteZones } from '@/features/microgrid-3d/hooks/use-site-zones';
import {
  clampQuantity,
  clampWatts,
  MAX_APPLIANCES,
  MAX_NAME,
  MAX_QUANTITY,
} from '../utils/appliance-draft';

export interface ApplianceInsertPanelProps {
  draft: ApplianceDraftState;
  /** Object outlined as scenery (house, car…): no load until the operator adds one. */
  scenery: boolean;
  /** This object's line is already in the simulation. */
  inSimulation: boolean;
  /** The engine list is full (30) and this object is not in it. */
  full: boolean;
  /** A 3D model is ready for this object: its grid connection mode can be stored (PI-T8). */
  canConnect?: boolean;
  onInsert: () => void;
  onRemove: () => void;
}

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

/** Electric or not (VS-T40): a non-electric object gets no load, pole or cable. */
const POWER_KINDS = [
  { electric: true, label: 'insertElectric' },
  { electric: false, label: 'insertNonElectric' },
] as const;

const CONNECTION_MODES = [
  { mode: 'branch', label: 'connectionBranch' },
  { mode: 'ems', label: 'connectionEms' },
] as const;

/**
 * « Add to the simulation » block (PV-T11 / PV-T12): AI estimate (AI category + engine catalog power) or
 * manual values (catalog-bounded), engine preview, then insert / update / remove. Never computes energy.
 */
export function ApplianceInsertPanel({
  draft,
  scenery,
  inSimulation,
  full,
  canConnect = false,
  onInsert,
  onRemove,
}: ApplianceInsertPanelProps) {
  const t = useTranslations('features.visionInsert');
  const tSector = useTranslations('sectors');
  const id = useId();
  const [mapOpen, setMapOpen] = useState(false);
  const { draft: d, source, range, appliance, summary, curve } = draft;
  const zones = useSiteZones();
  const wattsOk = Number.isFinite(d.watts) && d.watts >= range.minW && d.watts <= range.maxW;
  const nearest = d.position ? nearestSector(d.position) : null;

  return (
    <section
      className="flex flex-col gap-3 border-t border-border pt-3"
      aria-labelledby={`${id}-title`}
    >
      <h4 id={`${id}-title`} className="text-xs font-semibold text-text-secondary">
        {t('insertTitle')}
      </h4>
      {scenery && !inSimulation && (
        <p className="text-xs text-text-muted">{t('insertSceneryNote')}</p>
      )}

      <div role="group" aria-label={t('insertSourceLabel')} className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          aria-pressed={source === 'ai'}
          onClick={draft.applyAiEstimate}
          className={cn(
            BUTTON,
            'border',
            source === 'ai'
              ? 'border-ai-violet/60 bg-ai-violet/15 text-ai-violet'
              : 'border-border bg-surface-elevated text-text-primary hover:bg-surface-hover'
          )}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('insertAi')}
        </button>
        <button
          type="button"
          aria-pressed={source === 'manual'}
          onClick={draft.setManual}
          className={cn(
            BUTTON,
            'border',
            source === 'manual'
              ? 'border-energy-cyan/60 bg-energy-cyan/15 text-text-primary'
              : 'border-border bg-surface-elevated text-text-primary hover:bg-surface-hover'
          )}
        >
          <PencilLine className="h-4 w-4" aria-hidden="true" />
          {t('insertManual')}
        </button>
      </div>
      <p className="text-xs text-text-muted">
        {t(source === 'ai' ? 'insertAiNote' : 'insertManualNote')}
      </p>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-text-secondary">{t('insertPowerKind')}</span>
        <div
          role="group"
          aria-label={t('insertPowerKind')}
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
        >
          {POWER_KINDS.map(({ electric, label }) => {
            const on = d.electric === electric;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => draft.setElectric(electric)}
                className={cn(
                  BUTTON,
                  'border px-2 text-center text-xs',
                  on
                    ? 'border-energy-cyan/60 bg-energy-cyan/15 text-text-primary'
                    : 'border-border bg-surface-elevated text-text-secondary hover:bg-surface-hover'
                )}
              >
                {t(label)}
              </button>
            );
          })}
        </div>
        {!d.electric && <p className="text-[11px] text-text-muted">{t('insertNonElectricNote')}</p>}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-text-secondary sm:col-span-2 lg:col-span-1 xl:col-span-2">
          {t('insertName')}
          <input
            type="text"
            value={d.name}
            maxLength={MAX_NAME}
            onChange={(e) => draft.setName(e.target.value)}
            className={cn(FIELD_CLASS, 'font-sans')}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('insertCategory')}
          <select
            value={d.category}
            onChange={(e) => draft.setCategory(e.target.value as ApplianceCategory)}
            className={cn(FIELD_CLASS, 'font-sans cursor-pointer')}
          >
            {APPLIANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <span className="text-xs text-text-secondary">{t('insertPosition')}</span>
          <p aria-live="polite" className="text-sm text-text-primary">
            {d.position
              ? t('placedAt', { x: d.position.x.toFixed(1), z: d.position.z.toFixed(1) })
              : t('ringDefault')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={mapOpen}
              onClick={() => setMapOpen((open) => !open)}
              className={cn(
                BUTTON,
                'border border-border bg-surface-elevated text-text-primary hover:bg-surface-hover'
              )}
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {t('placeOnMap')}
            </button>
            {d.position && (
              <button
                type="button"
                onClick={() => draft.setPosition(null)}
                className={cn(
                  BUTTON,
                  'border border-border bg-surface-elevated text-text-primary hover:bg-surface-hover'
                )}
              >
                {t('useRing')}
              </button>
            )}
          </div>
          {mapOpen && (
            <PlaceMinimap
              value={d.position}
              sector={d.sector}
              connectionMode={d.connectionMode}
              electric={d.electric}
              onPlace={draft.setPosition}
              zones={zones}
              excludeId={draft.id}
            />
          )}
        </div>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('insertFeeder')}
          <select
            value={d.sector}
            onChange={(e) => draft.setSector(e.target.value as SectorId)}
            className={cn(FIELD_CLASS, 'font-sans cursor-pointer')}
          >
            {SECTOR_IDS.map((s) => (
              <option key={s} value={s}>
                {tSector(s)}
              </option>
            ))}
          </select>
        </label>
        {nearest && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
            {t('nearestIs', { name: tSector(nearest) })}
            {!d.feederAuto && d.sector !== nearest && (
              <button
                type="button"
                onClick={draft.useNearestFeeder}
                className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface-elevated px-3 text-xs font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
              >
                {t('feederAuto')}
              </button>
            )}
          </p>
        )}
        {canConnect && d.electric && (
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1 xl:col-span-2">
            <span className="text-xs text-text-secondary">{t('insertConnection')}</span>
            <div
              role="group"
              aria-label={t('insertConnection')}
              className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
            >
              {CONNECTION_MODES.map(({ mode, label }) => {
                const on = (d.connectionMode ?? 'branch') === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={on}
                    onClick={() => draft.setConnectionMode(mode)}
                    className={cn(
                      BUTTON,
                      'border px-2 text-center text-xs',
                      on
                        ? 'border-energy-cyan/60 bg-energy-cyan/15 text-text-primary'
                        : 'border-border bg-surface-elevated text-text-secondary hover:bg-surface-hover'
                    )}
                  >
                    {t(label)}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-text-muted">
              {t('connectionNote', { sector: tSector(d.sector) })}
            </p>
          </div>
        )}
        {d.electric && (
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              {t('insertWatts')}
              <input
                type="number"
                inputMode="numeric"
                min={range.minW}
                max={range.maxW}
                value={Number.isFinite(d.watts) ? d.watts : ''}
                aria-invalid={!wattsOk}
                aria-describedby={`${id}-range`}
                onChange={(e) =>
                  draft.setWatts(e.target.value === '' ? Number.NaN : Number(e.target.value))
                }
                onBlur={() => !wattsOk && draft.setWatts(clampWatts(d.category, d.watts))}
                className={cn(FIELD_CLASS, !wattsOk && 'border-critical-red')}
              />
            </label>
            <span
              id={`${id}-range`}
              className={cn('text-[11px]', wattsOk ? 'text-text-muted' : 'text-critical-red')}
            >
              {t('insertWattsRange', { min: range.minW, max: range.maxW })}
            </span>
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t('insertQuantity')}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_QUANTITY}
            step={1}
            value={Number.isFinite(d.quantity) ? d.quantity : ''}
            onChange={(e) =>
              draft.setQuantity(e.target.value === '' ? Number.NaN : Number(e.target.value))
            }
            onBlur={() => draft.setQuantity(clampQuantity(d.quantity))}
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <p
        aria-live="polite"
        className="rounded-control border border-border bg-canvas-sunken px-3 py-2 text-xs text-text-secondary"
      >
        {summary
          ? t('insertPreview', {
              peak: fmtKw(summary.peakKw, 2),
              daily: fmtKwh(summary.dailyKwh, 2),
            })
          : t('insertInvalid')}
      </p>
      {d.electric && appliance && summary && curve && (
        <ApplianceCurveChart curve={curve} peakKw={summary.peakKw} dailyKwh={summary.dailyKwh} />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!appliance || full}
          onClick={onInsert}
          className={cn(BUTTON, 'flex-1 bg-energy-cyan text-slate-950 hover:bg-energy-cyan/90')}
        >
          {inSimulation ? (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {t(inSimulation ? 'insertUpdate' : 'insertButton')}
        </button>
        {inSimulation && (
          <button
            type="button"
            onClick={onRemove}
            className={cn(
              BUTTON,
              'border border-border bg-surface-elevated text-text-primary hover:bg-surface-hover hover:text-critical-red'
            )}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('insertRemove')}
          </button>
        )}
      </div>
      {full && (
        <p className="text-xs text-text-muted">{t('insertFull', { max: MAX_APPLIANCES })}</p>
      )}
      {inSimulation && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-battery-green">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('insertDone')}
        </p>
      )}
    </section>
  );
}
