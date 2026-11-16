/**
 * In-headset keyboard of the VR chat (VS-T27): one plane, keys found from the ray's UV, so it
 * costs one draw call and works the same with controllers, hands, the mouse and the emulator.
 * French gets AZERTY with its accents; English and Malagasy get QWERTY.
 */
export type KeyAction = 'char' | 'shift' | 'space' | 'back' | 'clear';

export interface KeyDef {
  /** Character typed (`char`), or the action's id. */
  value: string;
  action: KeyAction;
  /** Width in key units (a row is 10 units). */
  w: number;
}

export interface KeyRect extends KeyDef {
  /** Left / top edge and size in 0–1 of the keyboard (top-left origin). */
  x: number;
  y: number;
  width: number;
  height: number;
}

const ROW_UNITS = 10;
const chars = (s: string): KeyDef[] => [...s].map((c) => ({ value: c, action: 'char', w: 1 }));

const QWERTY = ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm,.?'];
const AZERTY = ['1234567890', 'azertyuiop', 'qsdfghjklm', 'wxcvbnéèàç'];

/** Rows of the keyboard for a locale: 4 rows of 10 keys, then shift · space · backspace · clear. */
export function keyboardRows(locale: string): KeyDef[][] {
  const rows = (locale.startsWith('fr') ? AZERTY : QWERTY).map(chars);
  rows.push([
    { value: 'shift', action: 'shift', w: 1.5 },
    { value: ' ', action: 'space', w: 5 },
    { value: 'back', action: 'back', w: 2 },
    { value: 'clear', action: 'clear', w: 1.5 },
  ]);
  return rows;
}

/** Key rectangles in keyboard space (0–1, top-left origin), rows centred. */
export function keyRects(rows: KeyDef[][]): KeyRect[] {
  const height = 1 / rows.length;
  return rows.flatMap((row, r) => {
    const units = row.reduce((a, k) => a + k.w, 0);
    let x = (ROW_UNITS - units) / 2 / ROW_UNITS;
    return row.map((k) => {
      const width = k.w / ROW_UNITS;
      const rect = { ...k, x, y: r * height, width, height };
      x += width;
      return rect;
    });
  });
}

/** Key under a UV hit (three's UV: origin bottom-left), or null between keys / outside. */
export function keyAtUv(rects: readonly KeyRect[], u: number, v: number): KeyRect | null {
  const y = 1 - v;
  return rects.find((k) => u >= k.x && u < k.x + k.width && y >= k.y && y < k.y + k.height) ?? null;
}

export interface KeyboardState {
  draft: string;
  shift: boolean;
}

/** Applies one key to the draft; shift is one-shot (next letter only), like the system keyboard. */
export function pressKey(state: KeyboardState, key: KeyDef, maxChars: number): KeyboardState {
  switch (key.action) {
    case 'shift':
      return { ...state, shift: !state.shift };
    case 'back':
      return { ...state, draft: [...state.draft].slice(0, -1).join('') };
    case 'clear':
      return { draft: '', shift: false };
    case 'space':
    case 'char': {
      if ([...state.draft].length >= maxChars) return state;
      const c = key.action === 'space' ? ' ' : state.shift ? key.value.toUpperCase() : key.value;
      return { draft: state.draft + c, shift: false };
    }
  }
}
