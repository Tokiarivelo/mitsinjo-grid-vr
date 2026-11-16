/**
 * Controls of the /village VR studio (VS-T23): one explicit map for controllers and hands, after
 * Meta's input maps (design/controllers, design/locomotion-input-maps). Pure: reads gamepad
 * snapshots, returns discrete actions; the studio applies them.
 *
 * Controllers (xr-standard: 0 trigger, 1 grip, 3 stick press, 4 A/X, 5 B/Y; axes 2–3 stick):
 * - Trigger: select what the ray points at (both hands). Grip held: turn a miniature.
 * - Left stick: walk (slide, head-relative). Right stick ←/→: snap turn 30°, ↑/↓: one step.
 * - A / X: analyse the current view. B / Y: back (close what is open, else the menu).
 * - Stick click: show / hide the help labels (on release). Stick held 0.8 s: show / hide the
 *   hand and controller models (VS-T30; the lasers stay).
 * Hands (both the same, Meta: left and right gestures never differ):
 * - Pinch: select; pinch held: turn a miniature / drag the views.
 * - Thumb microgestures (hand gamepad buttons 5–9, when the browser exposes them): swipe ←/→
 *   snap turn, swipe forward / back one step, tap analyses the view.
 */

export type XrControlAction =
  | { type: 'turn'; direction: -1 | 1 }
  | { type: 'step'; direction: -1 | 1 }
  | { type: 'analyse' }
  | { type: 'back' }
  | { type: 'help' }
  | { type: 'inputs' };

/** Snap turn (rad): 30°, Meta's default increment. */
export const SNAP_TURN = Math.PI / 6;
/** One step (m): Meta's back step is 80 cm. */
export const STEP_DISTANCE = 0.8;
/** Stick past this fires a snap / step; it re-arms once back under `STICK_REARM`. */
export const STICK_FIRE = 0.7;
export const STICK_REARM = 0.3;
/** Stick pressed this long (s) toggles the hand / controller models instead of the help. */
export const STICK_HOLD = 0.8;
/** Held stick repeats a snap / step every this many seconds. */
export const STICK_REPEAT = 0.6;

export const PAD = { trigger: 0, grip: 1, stick: 3, primary: 4, secondary: 5 } as const;
/** Hand gamepad (xr-standard) microgesture buttons, as IWER and Quest expose them. */
export const MICROGESTURE = {
  swipeLeft: 5,
  swipeRight: 6,
  swipeForward: 7,
  swipeBackward: 8,
  tap: 9,
} as const;

/** What the studio needs from one XR input source (a snapshot, no live objects kept). */
export interface ControlSource {
  handedness: 'left' | 'right' | 'none';
  hand: boolean;
  buttons: readonly boolean[];
  axes: readonly number[];
}

/** Edge / repeat memory of one source, kept between frames. */
interface SourceMemory {
  buttons: boolean[];
  /** Stick armed for the next snap / step (x, y), and when a held one repeats next. */
  armedX: boolean;
  armedY: boolean;
  repeatAt: number;
  /** When the stick was pressed (s), and whether that press already fired its hold action. */
  stickAt: number;
  stickHeld: boolean;
}

export type ControlMemory = Map<string, SourceMemory>;

export function createControlMemory(): ControlMemory {
  return new Map();
}

const keyOf = (s: ControlSource) => `${s.hand ? 'hand' : 'pad'}:${s.handedness}`;

/** Thumbstick x / y of a source (xr-standard axes 2–3, else 0–1). */
export function stickOf(axes: readonly number[]): [number, number] {
  if (axes.length >= 4) return [axes[2] ?? 0, axes[3] ?? 0];
  return [axes[0] ?? 0, axes[1] ?? 0];
}

/**
 * Actions fired this frame by every source (rising edges, held-stick repeats). `now` in seconds.
 * The left stick only walks (continuous, read by the tour), so it fires nothing here.
 */
export function readControls(
  sources: readonly ControlSource[],
  memory: ControlMemory,
  now: number
): XrControlAction[] {
  const out: XrControlAction[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const key = keyOf(s);
    seen.add(key);
    let m = memory.get(key);
    if (!m) {
      // First sight: buttons already down do not fire (no action on entering the session).
      m = {
        buttons: [...s.buttons],
        armedX: true,
        armedY: true,
        repeatAt: 0,
        stickAt: Number.NaN,
        stickHeld: false,
      };
      memory.set(key, m);
      continue;
    }
    const rose = (i: number) => !!s.buttons[i] && !m.buttons[i];
    const fell = (i: number) => !s.buttons[i] && !!m.buttons[i];
    if (s.hand) {
      if (rose(MICROGESTURE.swipeLeft)) out.push({ type: 'turn', direction: -1 });
      if (rose(MICROGESTURE.swipeRight)) out.push({ type: 'turn', direction: 1 });
      if (rose(MICROGESTURE.swipeForward)) out.push({ type: 'step', direction: 1 });
      if (rose(MICROGESTURE.swipeBackward)) out.push({ type: 'step', direction: -1 });
      if (rose(MICROGESTURE.tap)) out.push({ type: 'analyse' });
    } else {
      if (rose(PAD.primary)) out.push({ type: 'analyse' });
      if (rose(PAD.secondary)) out.push({ type: 'back' });
      // Stick: a click toggles the help on release; held STICK_HOLD it toggles the models.
      if (rose(PAD.stick)) {
        m.stickAt = now;
        m.stickHeld = false;
      } else if (s.buttons[PAD.stick] && !m.stickHeld && now - m.stickAt >= STICK_HOLD) {
        out.push({ type: 'inputs' });
        m.stickHeld = true;
      } else if (fell(PAD.stick)) {
        if (!m.stickHeld && !Number.isNaN(m.stickAt)) out.push({ type: 'help' });
        m.stickAt = Number.NaN;
      }
      // The right stick turns and steps back; the left one walks (Meta: left moves, right turns).
      if (s.handedness !== 'left') {
        const [x, y] = stickOf(s.axes);
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        const held = ax >= STICK_FIRE || ay >= STICK_FIRE;
        if (ax < STICK_REARM) m.armedX = true;
        if (ay < STICK_REARM) m.armedY = true;
        if (ax >= STICK_FIRE && (m.armedX || now >= m.repeatAt)) {
          out.push({ type: 'turn', direction: x > 0 ? 1 : -1 });
          m.armedX = false;
          m.repeatAt = now + STICK_REPEAT;
        } else if (ay >= STICK_FIRE && ax < STICK_REARM && (m.armedY || now >= m.repeatAt)) {
          // Stick up = forward (xr-standard y is negative up).
          out.push({ type: 'step', direction: y < 0 ? 1 : -1 });
          m.armedY = false;
          m.repeatAt = now + STICK_REPEAT;
        } else if (!held) m.repeatAt = 0;
      }
    }
    m.buttons = [...s.buttons];
  }
  for (const key of [...memory.keys()]) if (!seen.has(key)) memory.delete(key);
  return out;
}

/** Snapshot of live WebXR input sources (no references kept). */
export function snapshotSources(
  sources: Iterable<{
    handedness: XRHandedness;
    hand?: unknown;
    gamepad?: Gamepad | null;
  }>
): ControlSource[] {
  const out: ControlSource[] = [];
  for (const s of sources) {
    const pad = s.gamepad;
    if (!pad) continue;
    out.push({
      handedness: s.handedness,
      hand: !!s.hand,
      buttons: pad.buttons.map((b) => b.pressed),
      axes: pad.axes,
    });
  }
  return out;
}

/** Only the left stick walks (the right one snaps turns and steps). */
export function isWalkStick(source: { handedness: XRHandedness; hand?: unknown }): boolean {
  return !source.hand && source.handedness === 'left';
}
