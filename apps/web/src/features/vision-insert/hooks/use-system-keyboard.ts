'use client';

import { useCallback, useEffect, useRef } from 'react';

/** `XRSession.isSystemKeyboardSupported` (Quest Browser ≥ 26.1), not in the DOM typings. */
type KeyboardSession = XRSession & { isSystemKeyboardSupported?: boolean };

export const systemKeyboardSupported = (session: XRSession | null | undefined) =>
  Boolean((session as KeyboardSession | null | undefined)?.isSystemKeyboardSupported);

/**
 * Quest's system keyboard in a WebXR session (Meta « System Keyboard in WebXR »): a hidden text
 * field gets focus, the keyboard (with its voice dictation key) types into it, every change goes
 * to `onText` with the whole value. Each opening is a new editing session that replaces the value,
 * so the field starts from the current draft. The field leaves the DOM on unmount.
 */
export function useSystemKeyboard(onText: (text: string) => void, maxChars: number) {
  const field = useRef<HTMLInputElement | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });
  useEffect(
    () => () => {
      field.current?.remove();
      field.current = null;
    },
    []
  );
  return useCallback(
    (draft: string) => {
      if (typeof document === 'undefined') return;
      let input = field.current;
      if (!input) {
        input = document.createElement('input');
        input.type = 'text';
        input.maxLength = maxChars;
        input.setAttribute('aria-hidden', 'true');
        input.tabIndex = -1;
        // In the viewport (off-screen makes the page scroll to it), invisible, no layout.
        input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
        input.oninput = () => onTextRef.current(input!.value);
        document.body.appendChild(input);
        field.current = input;
      }
      input.value = draft;
      input.focus();
    },
    [maxChars]
  );
}
