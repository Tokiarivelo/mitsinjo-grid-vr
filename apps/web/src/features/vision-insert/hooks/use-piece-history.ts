import { useCallback, useState } from 'react';
import type { PieceEdits } from '@/lib/piece-edits';

/** Steps kept for undo. */
export const HISTORY_MAX = 50;

interface History {
  past: PieceEdits[];
  present: PieceEdits;
  future: PieceEdits[];
}

/**
 * The 3D Studio's undo / redo over the piece edits (PQ-T77). `commit` records a step (a gizmo
 * drag, a toggle, a slider released); `preview` changes the present without a step (a slider
 * being dragged), and the release commits with `from` = the edits before the drag. At most
 * `HISTORY_MAX` steps back.
 */
export function usePieceHistory(initial: PieceEdits | undefined) {
  const [h, setH] = useState<History>({ past: [], present: initial ?? {}, future: [] });
  const commit = useCallback(
    (next: PieceEdits, from?: PieceEdits) =>
      setH((s) => {
        const before = from ?? s.present;
        if (next === before) return s;
        return { past: [...s.past, before].slice(-HISTORY_MAX), present: next, future: [] };
      }),
    []
  );
  const preview = useCallback((next: PieceEdits) => setH((s) => ({ ...s, present: next })), []);
  const undo = useCallback(
    () =>
      setH((s) =>
        s.past.length
          ? { past: s.past.slice(0, -1), present: s.past.at(-1)!, future: [s.present, ...s.future] }
          : s
      ),
    []
  );
  const redo = useCallback(
    () =>
      setH((s) =>
        s.future.length
          ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) }
          : s
      ),
    []
  );
  return {
    edits: h.present,
    commit,
    preview,
    undo,
    redo,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}
