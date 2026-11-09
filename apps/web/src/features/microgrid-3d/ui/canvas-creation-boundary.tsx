'use client';

import { Component, type ReactNode } from 'react';

interface CanvasCreationBoundaryProps {
  /** Called once when the canvas subtree throws during creation. */
  onFail?: () => void;
  /** Optional fallback UI when canvas initialization fails. */
  fallback?: ReactNode;
  children: ReactNode;
}

interface CanvasCreationBoundaryState {
  failed: boolean;
}

/**
 * Catches a `<Canvas>` that throws at creation (the browser blocks new WebGL
 * contexts after repeated losses: "Web page caused context loss and was blocked").
 * Renders fallback or nothing — the caller shows its placeholder and retries on a fresh
 * boundary (key it by the context-loss epoch), giving up after MAX_CONTEXT_REMOUNTS.
 */
export class CanvasCreationBoundary extends Component<
  CanvasCreationBoundaryProps,
  CanvasCreationBoundaryState
> {
  state: CanvasCreationBoundaryState = { failed: false };

  static getDerivedStateFromError(): CanvasCreationBoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onFail?.();
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
