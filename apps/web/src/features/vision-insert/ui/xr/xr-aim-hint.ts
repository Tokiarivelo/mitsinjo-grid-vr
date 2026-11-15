/**
 * What the select under the laser will do, said next to its end (VS-T23): « Trigger · Extract
 * « Fridge » in 3D », « Pinch · Go to the hall ». Pure: returns i18n keys of
 * `features.visionInsert.vrControls` and their values; the hint component translates them.
 */
export type AimHintKind =
  'wrist' | 'panel' | 'miniature' | 'button' | 'hotspot' | 'target' | 'screen' | 'none';

export interface AimHintInput {
  kind: AimHintKind;
  id: string | null;
  input: 'controller' | 'hand' | 'mouse';
}

export interface AimHintContext {
  /** Display name of a detected object (localised), null when unknown. */
  targetName: (id: string) => string | null;
  isMaterialized: (id: string) => boolean;
  isConnected: (id: string) => boolean;
  /** Display name of the place a floor arrow leads to, null when not an arrow. */
  placeOf: (hotspotId: string) => string | null;
  menuOpen: boolean;
  /** A shot beside the analysed photo analyses the view there (360° tour, nothing open). */
  outsideAnalyses: boolean;
  /** A shot on the photo analyses it (nothing found on it yet, nothing open). */
  screenAnalyses: boolean;
}

export interface AimHint {
  verb: 'verbTrigger' | 'verbPinch' | 'verbClick';
  action: string;
  values?: Record<string, string>;
}

const VERB = { controller: 'verbTrigger', hand: 'verbPinch', mouse: 'verbClick' } as const;

/** The hint of one pointer, or null when there is nothing to say (panels label themselves). */
export function aimHint(aim: AimHintInput, ctx: AimHintContext): AimHint | null {
  const verb = VERB[aim.input];
  const id = aim.id;
  switch (aim.kind) {
    case 'wrist':
      return { verb, action: ctx.menuOpen ? 'menuClose' : 'menuOpen' };
    case 'button':
      return { verb, action: 'scanButton' };
    case 'hotspot': {
      const room = id ? ctx.placeOf(id) : null;
      return room ? { verb, action: 'goTo', values: { room } } : null;
    }
    case 'target': {
      if (!id) return null;
      const name = ctx.targetName(id) ?? '';
      if (!ctx.isMaterialized(id)) return { verb, action: 'extract', values: { name } };
      return ctx.isConnected(id)
        ? { verb, action: 'disconnect', values: { name } }
        : { verb, action: 'connect', values: { name } };
    }
    case 'miniature':
      return { verb, action: 'turnModel' };
    case 'none':
      return ctx.outsideAnalyses ? { verb, action: 'analyse' } : null;
    case 'screen':
      return ctx.screenAnalyses ? { verb, action: 'analyse' } : null;
    default:
      return null;
  }
}

/** Cache key of a pointer's hint: the text is rebuilt only when this changes. */
export function aimHintKey(aim: AimHintInput, ctx: AimHintContext): string {
  const state =
    aim.kind === 'target' && aim.id
      ? `${ctx.isMaterialized(aim.id) ? 1 : 0}${ctx.isConnected(aim.id) ? 1 : 0}`
      : '';
  return `${aim.input}|${aim.kind}|${aim.id ?? ''}|${state}|${ctx.menuOpen ? 1 : 0}${ctx.outsideAnalyses ? 1 : 0}${ctx.screenAnalyses ? 1 : 0}`;
}
