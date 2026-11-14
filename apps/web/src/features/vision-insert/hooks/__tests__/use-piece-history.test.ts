import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HISTORY_MAX, usePieceHistory } from '../use-piece-history';

describe('usePieceHistory (3D Studio undo / redo)', () => {
  it('commits, undoes and redoes; a preview is not a step', () => {
    const { result } = renderHook(() => usePieceHistory({ roof: { hidden: true } }));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commit({ glass: { opacity: 0.5 } }));
    act(() => result.current.preview({ glass: { opacity: 0.4 } }));
    expect(result.current.edits).toEqual({ glass: { opacity: 0.4 } });
    // The slider released: one step from where the drag started.
    const start = result.current.edits;
    act(() => result.current.preview({ glass: { opacity: 0.3 } }));
    act(() => result.current.commit(result.current.edits, start));
    act(() => result.current.undo());
    expect(result.current.edits).toEqual({ glass: { opacity: 0.4 } });
    act(() => result.current.undo());
    expect(result.current.edits).toEqual({ roof: { hidden: true } });
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.edits).toEqual({ glass: { opacity: 0.4 } });
    act(() => result.current.redo());
    act(() => result.current.undo());
    // A new step drops the redo branch.
    act(() => result.current.undo());
    act(() => result.current.commit({}));
    expect(result.current.canRedo).toBe(false);
  });

  it(`keeps at most ${HISTORY_MAX} steps`, () => {
    const { result } = renderHook(() => usePieceHistory(undefined));
    for (let i = 0; i < HISTORY_MAX + 5; i++)
      act(() => result.current.commit({ p: { opacity: 0.1 + i / 100 } }));
    let n = 0;
    while (result.current.canUndo) {
      act(() => result.current.undo());
      n++;
    }
    expect(n).toBe(HISTORY_MAX);
  });
});
