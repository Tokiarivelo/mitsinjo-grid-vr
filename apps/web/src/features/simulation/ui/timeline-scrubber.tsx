'use client';

import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import type { StepResult } from '@mitsinjo/engine';
import { cn } from '@/lib/utils';
import { fmtHour, fmtKw, fmtPct } from '@/lib/format';
import { useTranslations } from '@/lib/i18n';
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from '@/stores/simulation.store';
import { useSmoothScrub } from '../hooks/use-smooth-scrub';
import { playbackTickMs } from '../hooks/use-playback-ticker';

const LAST_HOUR = 23;

/** Keys that step whole hours (the thumb itself moves continuously under the pointer). */
const KEY_STEP: Record<string, (h: number) => number> = {
  ArrowLeft: (h) => h - 1,
  ArrowDown: (h) => h - 1,
  ArrowRight: (h) => h + 1,
  ArrowUp: (h) => h + 1,
  PageDown: (h) => h - 6,
  PageUp: (h) => h + 6,
  Home: () => 0,
  End: () => LAST_HOUR,
};

export interface TimelineScrubberProps {
  timeIndex: number;
  onTimeChange: (timeIndex: number) => void;
  stepResult?: StepResult | null;
  hasResults?: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRestart: () => void;
  /** Playback speed multiplier (0.25x, 0.5x, 1x, 2x, 4x). */
  playbackSpeed?: PlaybackSpeed;
  /** Select callback to adjust the day's running speed. */
  onPlaybackSpeedChange?: (speed: PlaybackSpeed) => void;
  /** Scale model drives the hour: transport buttons hidden, thumb runs as a live clock. */
  followsDevice?: boolean;
  /** Real length of one model hour (ms) while following; drives the live-clock thumb. */
  deviceHourMs?: number | null;
  /** One slim row: transport, hour and slider only (no title, ticks or telemetry). */
  compact?: boolean;
  /** Shows a minimize / expand button that calls this. */
  onToggleCompact?: () => void;
  className?: string;
}

export function TimelineScrubber({
  timeIndex,
  onTimeChange,
  stepResult,
  hasResults = false,
  isPlaying,
  onTogglePlay,
  onPause,
  onStop,
  onRestart,
  playbackSpeed = 1,
  onPlaybackSpeedChange,
  followsDevice = false,
  deviceHourMs = null,
  compact = false,
  onToggleCompact,
  className,
}: TimelineScrubberProps) {
  const tSim = useTranslations('features.simulation');

  // Manual scrubbing takes over from playback.
  const seek = (hour: number) => {
    if (isPlaying) onPause();
    onTimeChange(hour);
  };

  const handlePrev = () => seek((timeIndex - 1 + 24) % 24);
  const handleNext = () => seek((timeIndex + 1) % 24);

  const scrub = useSmoothScrub({
    max: LAST_HOUR,
    value: timeIndex,
    onSeek: seek,
    playingGlideMs: isPlaying ? playbackTickMs(playbackSpeed) : undefined,
    leadMs: followsDevice && deviceHourMs ? deviceHourMs : undefined,
  });
  const fillPct = (scrub.pos / LAST_HOUR) * 100;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    scrub.onInput(parseFloat(e.target.value));
  };

  const handleSliderKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const step = KEY_STEP[e.key];
    if (!step) return;
    e.preventDefault();
    seek(Math.min(LAST_HOUR, Math.max(0, step(timeIndex))));
  };

  const transport = (
    <>
      {!followsDevice && (
        <>
          <button
            type="button"
            onClick={handlePrev}
            aria-label={tSim('stepBackward')}
            className="p-1.5 rounded-control text-text-secondary hover:text-text-primary hover:bg-surface-elevated border border-border transition-colors cursor-pointer"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? tSim('pausePlayback') : tSim('startPlayback')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-control text-xs font-sans font-medium transition-colors cursor-pointer border',
              isPlaying
                ? 'bg-solar-amber/20 text-solar-amber border-solar-amber/40 shadow-xs'
                : 'bg-surface-elevated text-text-primary border-border hover:bg-surface-hover'
            )}
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{tSim('pause')}</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 shrink-0 fill-current" aria-hidden="true" />
                <span>{tSim('play')}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleNext}
            aria-label={tSim('stepForward')}
            title={tSim('stepForward')}
            className="p-1.5 rounded-control text-text-secondary hover:text-text-primary hover:bg-surface-elevated border border-border transition-colors cursor-pointer"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onStop}
            aria-label={tSim('stopPlayback')}
            title={tSim('stopPlayback')}
            className="p-1.5 rounded-control text-text-muted hover:text-text-primary hover:bg-surface-elevated border border-border transition-colors cursor-pointer"
          >
            <Square className="h-3 w-3 fill-current" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onRestart}
            aria-label={tSim('restartPlayback')}
            title={tSim('restartPlayback')}
            className="p-1.5 rounded-control text-text-muted hover:text-text-primary hover:bg-surface-elevated border border-border transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      )}

      {/* Playback Speed Selector */}
      {!followsDevice && onPlaybackSpeedChange && (
        <div className="relative inline-flex items-center ml-1">
          <select
            value={playbackSpeed}
            onChange={(e) => onPlaybackSpeedChange(parseFloat(e.target.value) as PlaybackSpeed)}
            aria-label={tSim('playbackSpeed')}
            title={tSim('playbackSpeed')}
            className="appearance-none bg-surface-elevated text-text-secondary hover:text-text-primary border border-border hover:border-border-strong rounded-control font-mono cursor-pointer transition-colors text-xs h-7 pl-2 pr-5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan"
          >
            {PLAYBACK_SPEEDS.map((spd) => (
              <option key={spd} value={spd} className="bg-surface text-text-primary">
                {spd}x
              </option>
            ))}
          </select>
          <span
            className="absolute right-1.5 text-text-muted pointer-events-none text-[8px] select-none"
            aria-hidden="true"
          >
            ▼
          </span>
        </div>
      )}

      {/* Current Hour Pill */}
      <div className="ml-2 px-2.5 py-1 rounded-control bg-surface-elevated border border-energy-cyan/40 text-energy-cyan font-mono tabular-nums text-xs font-semibold">
        {fmtHour(timeIndex)}
      </div>
    </>
  );

  const slider = (
    <input
      type="range"
      min={0}
      max={LAST_HOUR}
      step="any"
      value={scrub.pos}
      onChange={handleSliderChange}
      onPointerDown={scrub.onDragStart}
      onKeyDown={handleSliderKey}
      aria-valuemin={0}
      aria-valuemax={LAST_HOUR}
      aria-valuenow={timeIndex}
      aria-valuetext={fmtHour(timeIndex)}
      aria-label={tSim('timelineScrubberLabel')}
      style={{
        background: `linear-gradient(to right, var(--color-energy-cyan) ${fillPct}%, var(--color-surface-elevated) ${fillPct}%)`,
      }}
      className="w-full h-2 bg-surface-elevated rounded-lg appearance-none cursor-pointer accent-energy-cyan
        touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    />
  );

  const toggleButton = onToggleCompact && (
    <button
      type="button"
      onClick={onToggleCompact}
      aria-label={compact ? tSim('timelineExpand') : tSim('timelineMinimize')}
      title={compact ? tSim('timelineExpand') : tSim('timelineMinimize')}
      aria-expanded={!compact}
      className="ml-1 p-1.5 rounded-control text-text-muted hover:text-text-primary hover:bg-surface-elevated border border-border transition-colors cursor-pointer"
    >
      {compact ? (
        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );

  if (compact) {
    // Slim bar: on phones the slider takes its own line under the buttons.
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-1.5 gap-y-2 px-3 py-2 rounded-card bg-surface border border-border shadow-sm',
          className
        )}
      >
        {transport}
        <div className="order-last basis-full sm:order-none sm:basis-0 sm:flex-1 min-w-0 px-1">
          {slider}
        </div>
        {toggleButton}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 p-4 rounded-card bg-surface border border-border shadow-sm',
        className
      )}
    >
      {/* Header: Title, Active Time badge, Playback Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-control-sm bg-energy-cyan/15 text-energy-cyan">
            <Clock className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-text-primary">
              {tSim('timelineTitle')}
            </h3>
            <p className="text-[11px] text-text-secondary">{tSim('timelineSubtitle')}</p>
          </div>
        </div>

        {/* Center/Right Playback Controls (hidden while the scale model drives the hour) */}
        <div className="flex items-center gap-1.5 self-start sm:self-center">
          {transport}
          {toggleButton}
        </div>
      </div>

      {/* Slider & 24h Tick Marks */}
      <div className="flex flex-col gap-1.5 px-1 pt-1">
        {slider}

        {/* 24-Hour Markers */}
        <div className="flex items-center justify-between text-[10px] font-mono text-text-muted select-none">
          <span>00:00</span>
          <span>06:00</span>
          <span className="text-solar-amber font-medium">12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      </div>

      {/* Live Step Telemetry at hour t (if simulation complete) */}
      {hasResults && stepResult && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-border/40 text-xs font-mono tabular-nums">
          <div className="p-2 rounded-control bg-surface-elevated/70 border border-border/60">
            <span className="text-[10px] text-text-muted block font-sans">{tSim('stepSolar')}</span>
            <span className="font-semibold text-solar-amber">{fmtKw(stepResult.solarKw)}</span>
          </div>

          <div className="p-2 rounded-control bg-surface-elevated/70 border border-border/60">
            <span className="text-[10px] text-text-muted block font-sans">
              {tSim('stepDemand')}
            </span>
            <span className="font-semibold text-energy-cyan">{fmtKw(stepResult.demandKw)}</span>
          </div>

          <div className="p-2 rounded-control bg-surface-elevated/70 border border-border/60">
            <span className="text-[10px] text-text-muted block font-sans">
              {tSim('stepServed')}
            </span>
            <span className="font-semibold text-battery-green">{fmtKw(stepResult.servedKw)}</span>
          </div>

          <div className="p-2 rounded-control bg-surface-elevated/70 border border-border/60">
            <span className="text-[10px] text-text-muted block font-sans">
              {tSim('stepBatteryPower')}
            </span>
            <span
              className={cn(
                'font-semibold',
                stepResult.batteryKw >= 0 ? 'text-battery-green' : 'text-solar-amber'
              )}
            >
              {stepResult.batteryKw >= 0 ? '+' : ''}
              {fmtKw(stepResult.batteryKw)}
            </span>
          </div>

          <div className="p-2 rounded-control bg-surface-elevated/70 border border-border/60 col-span-2 sm:col-span-1">
            <span className="text-[10px] text-text-muted block font-sans">
              {tSim('stepBatterySoc')}
            </span>
            <span className="font-semibold text-battery-green">{fmtPct(stepResult.socPct)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
