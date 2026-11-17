import type { XrControlAction } from './xr-controls';
import type { HoloIcon } from './holo-icons';
import { HOLO_ID_PREFIX } from './holo-panel';

/**
 * Hands-first navigation pad (Meta VR Start: « can someone finish the whole experience without
 * ever pairing a controller? »). On Quest, WebXR hands only expose the pinch (Meta « WebXR Hands »;
 * thumb microgestures are not documented for the browser), so the stick moves — snap turn and the
 * 80 cm step (Meta locomotion input maps) — also live on pinchable buttons. Seated users use them
 * too: no room-scale walking needed. The buttons only queue the same actions the sticks give; the
 * one `XrControlsDriver` of each world applies them, so the studio and the simulation stay in step.
 */

export interface NavPadButton {
  id: string;
  icon: HoloIcon;
  action: XrControlAction;
  /** i18n key under `features.visionInsert.vrControls` (hover popover name). */
  labelKey: 'navTurnLeft' | 'navStepBack' | 'navStepForward' | 'navTurnRight' | 'navHelp';
}

export const NAV_PAD_BUTTONS: readonly NavPadButton[] = [
  {
    id: 'xr-nav-turn-left',
    icon: 'turnLeft',
    action: { type: 'turn', direction: -1 },
    labelKey: 'navTurnLeft',
  },
  {
    id: 'xr-nav-step-back',
    icon: 'down',
    action: { type: 'step', direction: -1 },
    labelKey: 'navStepBack',
  },
  {
    id: 'xr-nav-step-forward',
    icon: 'up',
    action: { type: 'step', direction: 1 },
    labelKey: 'navStepForward',
  },
  {
    id: 'xr-nav-turn-right',
    icon: 'turnRight',
    action: { type: 'turn', direction: 1 },
    labelKey: 'navTurnRight',
  },
  { id: 'xr-nav-help', icon: 'help', action: { type: 'help' }, labelKey: 'navHelp' },
];

/** One button (m): ≥ 22 mm hit target for a ray pinch (Meta hands UI), roomy at ray distance. */
export const NAV_PAD_BUTTON = 0.085;
/** Gap between two buttons (m). */
export const NAV_PAD_GAP = 0.018;

/**
 * Pad position in the lazy-follow frame (m; x right, y up, at the follow distance ≈ 0.9 m): low
 * and centred, ≈ 20° under the eyes, so it stays inside a narrow field of view (Meta FoV-aware
 * design) and between the studio's « Menu » (left) and door (right) docks.
 */
export const NAV_PAD_OFFSET: [number, number, number] = [0, -0.34, 0];

/** Studio panel id of a pad button: the `holo:` prefix every studio panel carries (hover tick). */
export function navPadPanelId(id: string): string {
  return `${HOLO_ID_PREFIX}${id}`;
}

/** x of button `i` (centred row). */
export function navPadX(i: number, count = NAV_PAD_BUTTONS.length): number {
  const step = NAV_PAD_BUTTON + NAV_PAD_GAP;
  return Number(((i - (count - 1) / 2) * step).toFixed(4));
}

/** Total pad width (m). */
export function navPadWidth(count = NAV_PAD_BUTTONS.length): number {
  return count * NAV_PAD_BUTTON + (count - 1) * NAV_PAD_GAP;
}

/**
 * Actions pressed on the pad, waiting for the next frame of the world's controls driver. A module
 * queue, not React state: a press never re-renders the scene.
 */
const queue: XrControlAction[] = [];

export function pushNavAction(action: XrControlAction): void {
  queue.push(action);
}

/** Takes every queued action (oldest first) and empties the queue. */
export function drainNavActions(): XrControlAction[] {
  return queue.splice(0, queue.length);
}

/**
 * The pad is for hands only: on a real Quest, controllers already turn and step with their sticks,
 * so the pad shows while at least one hand is tracked and no controller is in use.
 */
export function handsOnly(sources: Iterable<{ hand?: unknown }>): boolean {
  let hands = 0;
  for (const s of sources) {
    if (!s.hand) return false;
    hands++;
  }
  return hands > 0;
}
