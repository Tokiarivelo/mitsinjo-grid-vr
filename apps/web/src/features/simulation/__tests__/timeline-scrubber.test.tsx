import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { scenarios, simulate } from '@mitsinjo/engine';
import { TimelineScrubber, type TimelineScrubberProps } from '../ui/timeline-scrubber';

const step = simulate(scenarios.baseline.input, 'essential_first').steps[20]!;

function props(over: Partial<TimelineScrubberProps> = {}): TimelineScrubberProps {
  return {
    timeIndex: 20,
    onTimeChange: vi.fn(),
    stepResult: step,
    hasResults: true,
    isPlaying: false,
    onTogglePlay: vi.fn(),
    onPause: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
    ...over,
  };
}

describe('TimelineScrubber compact mode', () => {
  it('has no minimize button unless the parent asks for one', () => {
    render(<TimelineScrubber {...props()} />);
    expect(screen.queryByRole('button', { name: 'Minimize the timeline' })).toBeNull();
    expect(screen.getByText('24h Timeline Scrubber')).toBeInTheDocument();
  });

  it('minimized keeps transport, hour and slider; drops title and telemetry', () => {
    const onToggleCompact = vi.fn();
    const { rerender } = render(<TimelineScrubber {...props({ onToggleCompact })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the timeline' }));
    expect(onToggleCompact).toHaveBeenCalledOnce();

    rerender(<TimelineScrubber {...props({ onToggleCompact, compact: true })} />);
    expect(screen.queryByText('24h Timeline Scrubber')).toBeNull();
    expect(screen.queryByText('Battery SoC')).toBeNull();
    expect(screen.getByRole('slider', { name: 'Hour of day scrubber' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start timeline playback' })).toBeInTheDocument();
    expect(screen.getByText('20:00')).toBeInTheDocument();
    const expand = screen.getByRole('button', { name: 'Expand the timeline' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders playback speed select and calls onPlaybackSpeedChange on user selection', () => {
    const onPlaybackSpeedChange = vi.fn();
    render(<TimelineScrubber {...props({ playbackSpeed: 1, onPlaybackSpeedChange })} />);
    const select = screen.getByRole('combobox', { name: 'Playback speed' });
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('1');

    fireEvent.change(select, { target: { value: '0.5' } });
    expect(onPlaybackSpeedChange).toHaveBeenCalledWith(0.5);

    fireEvent.change(select, { target: { value: '0.25' } });
    expect(onPlaybackSpeedChange).toHaveBeenCalledWith(0.25);
  });
});
