'use client';

import { memo, type ReactNode, type RefObject } from 'react';
import { Html } from '@react-three/drei';
import type { Priority } from '@mitsinjo/engine';
import { cn } from '@/lib/utils';
import type { StatusColor } from '../types';
import { STATUS_BG_CLASS } from '../utils/scene-palette';

/** Status beacon height above the top of what it labels (scene units). */
export const BEACON_GAP = 0.3;
/** Badge height above its beacon (scene units). */
export const BADGE_ABOVE_BEACON = 0.75;

/** Badge screen scale at the buildings' framing distance (drei `distanceFactor`). */
export const BADGE_DISTANCE_FACTOR = 18;

/** Beacon y for an object whose top is at `top` (PT-11d: one rule for buildings and objects). */
export const beaconY = (top: number): number => top + BEACON_GAP;
/** Badge y above the same beacon. */
export const badgeY = (beacon: number): number => beacon + BADGE_ABOVE_BEACON;

export interface SceneBadgeProps {
  /** World position of the badge anchor. */
  position: [number, number, number];
  htmlPortal?: RefObject<HTMLElement | null> | null;
  zIndexRange?: [number, number];
  /** Screen scale; a small object passes its camera focus scale so it reads like a focused building. */
  distanceFactor?: number;
  /** Glyph, already tinted. */
  icon: ReactNode;
  /** Disc classes behind the glyph (token classes). */
  iconClassName: string;
  title: string;
  /** Small "AI" tag while the AI dispatches alone; hidden when unset. */
  aiBadgeLabel?: string;
  statusColor: StatusColor;
  /** Omitted (no engine state yet) → the bottom line shows only the metric. */
  priority?: Priority;
  priorityLabel?: string;
  /** Right part of the bottom line, already formatted with its unit. */
  metric: string;
  selected: boolean;
  /** Fire or critical incident: red border + pulse. */
  alert: boolean;
  onClick?: () => void;
  /** Extra data attribute value for tests and shots. */
  dataId?: string;
}

/**
 * Glass status badge over a 3D object (PT-11a): sector buildings and inserted appliances share it,
 * so both read the same — icon, name, status dot, priority (critical in red) and one metric.
 */
export const SceneBadge = memo(function SceneBadge({
  position,
  htmlPortal,
  zIndexRange,
  distanceFactor = BADGE_DISTANCE_FACTOR,
  icon,
  iconClassName,
  title,
  aiBadgeLabel,
  statusColor,
  priority,
  priorityLabel,
  metric,
  selected,
  alert,
  onClick,
  dataId,
}: SceneBadgeProps) {
  if (htmlPortal === null) return null;

  return (
    <Html
      position={position}
      center
      distanceFactor={distanceFactor}
      portal={htmlPortal as RefObject<HTMLElement>}
      {...(zIndexRange ? { zIndexRange } : {})}
      className="pointer-events-auto select-none"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        aria-pressed={selected}
        data-scene-badge={dataId}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full shadow-xl backdrop-blur-md text-[11px] font-sans border transition-all cursor-pointer whitespace-nowrap',
          selected
            ? 'bg-surface-elevated/95 border-energy-cyan ring-2 ring-energy-cyan/50 scale-105'
            : alert
              ? 'bg-surface-elevated/95 border-critical-red ring-2 ring-critical-red/50 motion-safe:animate-pulse'
              : 'bg-surface/90 border border-border hover:border-text-secondary hover:bg-surface-hover'
        )}
      >
        <div
          className={cn(
            'w-5 h-5 rounded-full flex items-center justify-center shrink-0 border',
            iconClassName
          )}
        >
          {icon}
        </div>
        <div className="flex flex-col text-left leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-text-primary text-[11px]">{title}</span>
            {aiBadgeLabel && (
              <span className="px-1 py-px rounded text-[9px] font-mono font-bold bg-ai-violet/20 text-ai-violet border border-ai-violet/40">
                {aiBadgeLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <span
              className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_BG_CLASS[statusColor])}
              aria-hidden="true"
            />
            {priorityLabel && (
              <span
                data-priority={priority}
                className={cn(
                  priority === 'critical' ? 'text-critical-red font-semibold' : 'text-text-muted'
                )}
              >
                {priorityLabel}
              </span>
            )}
            <span className="text-text-secondary">{priorityLabel ? `· ${metric}` : metric}</span>
          </div>
        </div>
      </button>
    </Html>
  );
});
