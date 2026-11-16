import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { systemKeyboardSupported, useSystemKeyboard } from '../hooks/use-system-keyboard';

describe('useSystemKeyboard (VS-T27, Meta « System Keyboard in WebXR »)', () => {
  it('reads the session flag', () => {
    expect(systemKeyboardSupported(null)).toBe(false);
    expect(
      systemKeyboardSupported({ isSystemKeyboardSupported: true } as unknown as XRSession)
    ).toBe(true);
  });

  it('focuses a hidden field holding the draft, passes typing on, removes it on unmount', () => {
    const onText = vi.fn();
    const { result, unmount } = renderHook(() => useSystemKeyboard(onText, 50));
    result.current('red roof');
    const field = document.activeElement as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    expect(field.value).toBe('red roof');
    expect(field.maxLength).toBe(50);
    field.value = 'blue roof';
    field.dispatchEvent(new Event('input'));
    expect(onText).toHaveBeenCalledWith('blue roof');
    unmount();
    expect(field.isConnected).toBe(false);
  });
});
