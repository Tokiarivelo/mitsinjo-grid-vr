import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmulatedXRExit } from '../ui/emulated-xr-exit';

afterEach(() => {
  delete (window as Window & { __IWER_DEVICE__?: unknown }).__IWER_DEVICE__;
});

describe('EmulatedXRExit', () => {
  it('shows an exit button on <body> during an emulated session, and exits on click', () => {
    (window as Window & { __IWER_DEVICE__?: unknown }).__IWER_DEVICE__ = {};
    const onExit = vi.fn();
    render(<EmulatedXRExit active label="Exit VR" onExit={onExit} />);
    const button = screen.getByRole('button', { name: 'Exit VR' });
    expect(button.parentElement).toBe(document.body);
    fireEvent.click(button);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('renders nothing outside a session or on a real headset', () => {
    const { rerender } = render(<EmulatedXRExit active={false} label="Exit VR" onExit={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<EmulatedXRExit active label="Exit VR" onExit={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
