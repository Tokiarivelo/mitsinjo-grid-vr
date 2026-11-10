'use client';

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { isDevXREmulated } from '../utils/dev-xr-emulator';

export interface EmulatedXRExitProps {
  /** A VR session is running. */
  active: boolean;
  label: string;
  onExit: () => void;
}

/**
 * "Exit VR" during an emulated (IWER) session. The page is hidden then and IWER's full-screen
 * layer (z 999) covers it, so the button is portalled to <body> above that layer. Renders
 * nothing on a real headset or outside a session.
 */
export function EmulatedXRExit({ active, label, onExit }: EmulatedXRExitProps) {
  if (!active || typeof document === 'undefined' || !isDevXREmulated()) return null;
  return createPortal(
    <button
      type="button"
      onClick={onExit}
      data-xr-exit
      className="fixed right-3 top-3 z-[1001] flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface/90 px-4 text-sm font-medium text-text-primary shadow-lg backdrop-blur-md transition-colors hover:bg-surface-hover cursor-pointer"
    >
      <X className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </button>,
    document.body
  );
}
