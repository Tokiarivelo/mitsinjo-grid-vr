'use client';

import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { AppliancePosition, SectorId } from '@mitsinjo/engine';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  isBlocked,
  KEEP_OUT_ZONES,
  TERRAIN_RADIUS,
  type KeepOutZone,
} from '@/features/microgrid-3d/utils/landscape';
import { MAP_FEATURES, MAP_PINS } from '@/features/microgrid-3d/utils/sim-xr-minimap';
import { BUS_POSITION, SECTOR_POSITIONS } from '@/features/microgrid-3d/utils/site-positions';
import { tapPoint } from '@/features/microgrid-3d/utils/tap-point';
import type { ConnectionMode } from '@/stores/placed-models.store';

export interface PlaceMinimapProps {
  /** Placed spot (normalized) or null = ring default. */
  value: AppliancePosition | null;
  /** Cursor start when nothing is placed yet. */
  sector: SectorId;
  onPlace: (pos: AppliancePosition) => void;
  /** Site zones to show and test the cursor against (PI-T3, `siteZones`); default = static village. */
  zones?: readonly KeepOutZone[];
  /** Zone of the object being placed: not drawn, never blocks itself. */
  excludeId?: string;
  /** Grid connection mode (PI-T8/PI-T9): 'branch' (default) or 'ems'. */
  connectionMode?: ConnectionMode;
  /** False = non-electric object (VS-T40): no feeder cable, tap or pole drawn. */
  electric?: boolean;
}

/** Half-side of the square map (scene units), whole terrain: the terrain disc plus a margin. */
export const MINIMAP_HALF = 115;
/** Half-side of the village view (default, VS-T39): every building, road, the pond and paddy. */
export const MINIMAP_VILLAGE_HALF = 40;
/** Cursor step (Shift = ×5). */
export const MINIMAP_STEP = 2;

/** Ids of the fixed village zones (`KEEP_OUT_ZONES`). */
const STATIC_ZONE_IDS = new Set(KEEP_OUT_ZONES.map((k) => k.id));

const clampMap = (v: number, half: number) => Math.min(half - 2, Math.max(-(half - 2), v));
/** Path `d` of a polyline in map units. */
const polyline = (pts: ReadonlyArray<readonly [number, number]>) =>
  pts.reduce((acc, [x, z], i) => (i === 0 ? `M ${x} ${z}` : `${acc} L ${x} ${z}`), '');
/** Label halo drawn under the text (readable over roads and water in both themes). */
const HALO = { paintOrder: 'stroke' } as const;

/**
 * Top-down village map for free placement (PP-T4), drawn like the /simulation map (VS-T39): paddy,
 * lake and pond, laterite roads and paths, named buildings, the EMS shelter, placed objects and the
 * feeder cable. Opens on the village (zoom toggle for the whole terrain). Click (or tap) sets the
 * spot, arrow keys move the cursor and Enter places. +x right (east), +z down (south), north up.
 */
export function PlaceMinimap({
  value,
  sector,
  onPlace,
  zones = KEEP_OUT_ZONES,
  excludeId,
  connectionMode = 'branch',
  electric = true,
}: PlaceMinimapProps) {
  const t = useTranslations('features.visionInsert');
  const tSector = useTranslations('sectors');
  const [bx, , bz] = SECTOR_POSITIONS[sector];
  const [cursor, setCursor] = useState<AppliancePosition>(() =>
    value ? { ...value } : { x: bx, z: bz }
  );
  // A spot already placed out of the village view opens the whole terrain.
  const [wide, setWide] = useState(
    () => !!value && Math.max(Math.abs(value.x), Math.abs(value.z)) > MINIMAP_VILLAGE_HALF - 2
  );
  const half = wide ? MINIMAP_HALF : MINIMAP_VILLAGE_HALF;
  // Marks and names keep their on-screen size whatever the zoom.
  const k = half / MINIMAP_VILLAGE_HALF;
  const fontSize = 2.3 * k;

  // Placed objects only: static zones are drawn as buildings and the pond.
  const objects = useMemo(
    () => zones.filter((k) => k.id && k.id !== excludeId && !STATIC_ZONE_IDS.has(k.id)),
    [zones, excludeId]
  );
  const blocked = isBlocked(cursor.x, cursor.z, 0, zones, excludeId);

  // Derivation cable for the placed spot (PI-T9)
  const derivation = useMemo(() => {
    if (!value || !electric) return null;
    return tapPoint(value, sector, connectionMode, { zones, excludeId });
  }, [value, electric, sector, connectionMode, zones, excludeId]);

  const derivationPath = useMemo(() => {
    if (!derivation || !value) return null;
    const pts = derivation.waypoint
      ? [derivation.point, derivation.waypoint, [value.x, 0, value.z]]
      : [derivation.point, [value.x, 0, value.z]];
    return pts.reduce((acc, [x, , z], i) => (i === 0 ? `M ${x} ${z}` : `${acc} L ${x} ${z}`), '');
  }, [derivation, value]);

  const place = (pos: AppliancePosition) => {
    setCursor(pos);
    onPlace(pos);
  };

  const fromEvent = (e: MouseEvent<SVGSVGElement>): AppliancePosition => {
    const rect = e.currentTarget.getBoundingClientRect();
    const u = ((e.clientX - rect.left) / rect.width) * 2 * half - half;
    const v = ((e.clientY - rect.top) / rect.height) * 2 * half - half;
    return { x: clampMap(u, half), z: clampMap(v, half) };
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = MINIMAP_STEP * (e.shiftKey ? 5 : 1);
    const moves: Record<string, AppliancePosition> = {
      ArrowLeft: { x: cursor.x - step, z: cursor.z },
      ArrowRight: { x: cursor.x + step, z: cursor.z },
      ArrowUp: { x: cursor.x, z: cursor.z - step },
      ArrowDown: { x: cursor.x, z: cursor.z + step },
    };
    const next = moves[e.key];
    if (next) {
      e.preventDefault();
      setCursor({ x: clampMap(next.x, MINIMAP_HALF), z: clampMap(next.z, MINIMAP_HALF) });
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      place(cursor);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-text-muted">
          {wide ? t('minimapWideCaption') : t('minimapVillageCaption')}
        </p>
        <button
          type="button"
          aria-pressed={wide}
          onClick={() => setWide((w) => !w)}
          className="min-h-11 shrink-0 rounded-md border border-border bg-surface-elevated px-3 text-xs font-medium text-text-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan"
        >
          {wide ? t('minimapZoomVillage') : t('minimapZoomWide')}
        </button>
      </div>
      <svg
        viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`}
        role="application"
        tabIndex={0}
        aria-label={t('minimapLabel')}
        aria-describedby="place-minimap-help"
        onClick={(e) => place(fromEvent(e))}
        onKeyDown={onKeyDown}
        className="h-auto w-full cursor-crosshair rounded-lg border border-border bg-canvas-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan"
      >
        <circle
          r={TERRAIN_RADIUS}
          className="fill-surface-elevated stroke-border"
          strokeWidth={1.5 * k}
        />
        <rect
          data-testid="minimap-paddy"
          x={MAP_FEATURES.paddy.x - MAP_FEATURES.paddy.w / 2}
          y={MAP_FEATURES.paddy.z - MAP_FEATURES.paddy.d / 2}
          width={MAP_FEATURES.paddy.w}
          height={MAP_FEATURES.paddy.d}
          rx={0.6}
          className="fill-battery-green/35 stroke-battery-green/60"
          strokeWidth={0.3 * k}
        />
        {MAP_FEATURES.water.map((w, i) => (
          <circle
            key={`water-${i}`}
            data-testid="minimap-water"
            cx={w.x}
            cy={w.z}
            r={w.r}
            className="fill-network-blue/30 stroke-network-blue/60"
            strokeWidth={0.5 * k}
          />
        ))}
        {MAP_FEATURES.paths.map((path, idx) => (
          <path
            key={`path-${idx}`}
            data-testid="minimap-road"
            d={polyline(path)}
            className="stroke-solar-amber/55"
            strokeWidth={Math.max(MAP_FEATURES.pathWidth, 0.9 * k)}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {MAP_PINS.filter((p) => p.id !== 'dispatcher').map((p) => {
          const id = p.id as SectorId;
          const feeder = id === sector;
          return (
            <g key={id} data-testid={`minimap-sector-${id}`}>
              <circle
                cx={p.x}
                cy={p.z}
                r={1.6 * k}
                className={
                  feeder
                    ? 'fill-energy-cyan/50 stroke-energy-cyan'
                    : 'fill-text-muted/40 stroke-text-muted'
                }
                strokeWidth={0.5 * k}
              />
              <text
                x={p.x}
                y={p.z - 2.2 * k}
                textAnchor="middle"
                fontSize={fontSize}
                strokeWidth={fontSize * 0.28}
                style={HALO}
                className={cn(
                  'pointer-events-none select-none stroke-canvas-sunken font-semibold',
                  feeder ? 'fill-energy-cyan' : 'fill-text-primary'
                )}
              >
                {tSector(id)}
              </text>
            </g>
          );
        })}
        {/* Central Dispatch EMS Shelter (BUS_POSITION [0, 0, 1]) */}
        <g data-testid="minimap-ems">
          <rect
            x={BUS_POSITION[0] - 1.6 * k}
            y={BUS_POSITION[2] - 1.6 * k}
            width={3.2 * k}
            height={3.2 * k}
            rx={0.4 * k}
            className="fill-ai-violet/30 stroke-ai-violet"
            strokeWidth={0.5 * k}
          />
          <text
            x={BUS_POSITION[0]}
            y={BUS_POSITION[2] + 1.6 * k + fontSize}
            textAnchor="middle"
            fontSize={fontSize}
            strokeWidth={fontSize * 0.28}
            style={HALO}
            className="pointer-events-none select-none stroke-canvas-sunken font-mono font-bold fill-ai-violet"
          >
            {t('minimapEms')}
          </text>
        </g>
        {/* North arrow (indications, like the /simulation map) */}
        <g
          aria-hidden="true"
          transform={`translate(${half - 5 * k} ${-half + 5 * k})`}
          className="pointer-events-none select-none"
        >
          <path
            d={`M 0 ${-3 * k} L ${1.6 * k} ${1.6 * k} L 0 ${0.6 * k} L ${-1.6 * k} ${1.6 * k} Z`}
            className="fill-text-primary"
          />
          <text
            y={1.6 * k + fontSize}
            textAnchor="middle"
            fontSize={fontSize}
            className="fill-text-secondary font-bold"
          >
            {t('minimapNorth')}
          </text>
        </g>
        {objects.map((zone) => (
          <g key={zone.id} data-testid={`minimap-object-${zone.id}`}>
            <circle
              cx={zone.x}
              cy={zone.z}
              r={zone.r}
              className="fill-warning-amber/30 stroke-warning-amber"
              strokeWidth={0.4 * k}
            />
            <circle
              cx={zone.x}
              cy={zone.z}
              r={0.8 * k}
              className="fill-warning-amber stroke-slate-950"
              strokeWidth={0.3 * k}
            />
          </g>
        ))}
        {/* Derivation cable & poles for placed object (PI-T9) */}
        {derivationPath && (
          <path
            d={derivationPath}
            data-testid="minimap-derivation"
            className="stroke-energy-cyan/90 fill-none"
            strokeWidth={0.6 * k}
            strokeDasharray={`${1.5 * k} ${1 * k}`}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {derivation && (
          <g data-testid="minimap-derivation-hardware">
            <circle
              cx={derivation.point[0]}
              cy={derivation.point[2]}
              r={0.8 * k}
              data-testid="minimap-tap"
              className={
                connectionMode === 'ems'
                  ? 'fill-energy-cyan stroke-slate-950'
                  : 'fill-energy-cyan/80 stroke-border'
              }
              strokeWidth={0.4 * k}
            />
            {derivation.poles.map(([px, pz], i) => (
              <circle
                key={`pole-${i}`}
                cx={px}
                cy={pz}
                r={0.6 * k}
                data-testid="minimap-pole"
                className="fill-text-primary stroke-slate-950"
                strokeWidth={0.25 * k}
              />
            ))}
            {derivation.waypoint && (
              <circle
                cx={derivation.waypoint[0]}
                cy={derivation.waypoint[2]}
                r={0.7 * k}
                data-testid="minimap-corner-waypoint"
                className="fill-warning-amber stroke-slate-950"
                strokeWidth={0.3 * k}
              />
            )}
          </g>
        )}
        {value && (
          <circle
            data-testid="minimap-placed"
            cx={value.x}
            cy={value.z}
            r={1.4 * k}
            className="fill-energy-cyan stroke-slate-950"
            strokeWidth={0.5 * k}
          />
        )}
        <g
          className={blocked ? 'stroke-warning-amber' : 'stroke-energy-cyan'}
          strokeWidth={0.6 * k}
          aria-hidden="true"
          transform={`translate(${cursor.x} ${cursor.z})`}
        >
          <line x1={-3 * k} y1={0} x2={3 * k} y2={0} />
          <line x1={0} y1={-3 * k} x2={0} y2={3 * k} />
          <circle r={1.8 * k} fill="none" />
        </g>
      </svg>
      <p id="place-minimap-help" className="text-[11px] text-text-muted">
        {t('minimapHelp')}
      </p>
      {blocked && <p className="text-[11px] text-warning-amber">{t('minimapBlocked')}</p>}
      <p aria-live="polite" className="sr-only">
        {t('cursorAt', { x: cursor.x.toFixed(1), z: cursor.z.toFixed(1) })}
      </p>
    </div>
  );
}
