import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasCreationBoundary } from '../ui/canvas-creation-boundary';

function Boom(): ReactNode {
  throw new Error('WebGL context could not be created');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CanvasCreationBoundary', () => {
  it('renders children when creation succeeds', () => {
    const onFail = vi.fn();
    render(
      <CanvasCreationBoundary onFail={onFail}>
        <span>scene</span>
      </CanvasCreationBoundary>
    );
    expect(screen.getByText('scene')).toBeInTheDocument();
    expect(onFail).not.toHaveBeenCalled();
  });

  it('reports once and renders nothing when creation throws (blocked WebGL)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFail = vi.fn();
    render(
      <CanvasCreationBoundary onFail={onFail}>
        <Boom />
      </CanvasCreationBoundary>
    );
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toBe('');
  });
});
