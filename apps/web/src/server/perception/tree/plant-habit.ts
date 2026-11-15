import type { LeafType, PlantHabit } from '@/lib/plant-plan';

/**
 * How a plant grows, from its name (PQ-T82), in English, French and Malagasy: the plant team's
 * reading wins when there is one (`plant-tools.ts`); the shape of the drawing decides last
 * (`habitFromShape`). Pure.
 */

const NAMES: ReadonlyArray<[PlantHabit, RegExp]> = [
  ['weeping', /\b(weeping|willow|saule|pleureur|wisteria|glycine)\b/i],
  [
    'palm',
    /\b(palm|palms|palmier|satrana|bismarckia|latania|washingtonia|coconut|cocotier|date|dattier|raphia|vakona)\b/i,
  ],
  [
    'fan',
    /\b(banana|bananier|akondro|ravenala|traveller'?s|voyageur|strelitzia|heliconia|plantain)\b/i,
  ],
  [
    'conical',
    /\b(pine|pin|fir|sapin|spruce|[eé]pic[eé]a|conifer|conif[eè]re|araucaria|cedar|c[eè]dre|kesika|larch|m[eé]l[eè]ze)\b/i,
  ],
  ['columnar', /\b(cypress|cypr[eè]s|poplar|peuplier|thuja|juniper|geni[eè]vre)\b/i],
  ['bamboo', /\b(bamboo|bambou|volo)\b/i],
  ['cactus', /\b(cactus|cacti|opuntia|raketa|euphorbia|euphorbe|saguaro)\b/i],
  ['rosette', /\b(agave|aloe|alo[eè]s|sisal|pineapple|ananas|yucca|mananasy)\b/i],
  [
    'grass',
    /\b(grass|herbe|reed|roseau|papyrus|lemongrass|citronnelle|bozaka|vetiver|v[eé]tiver|rice|riz|vary|sugar ?cane|canne)\b/i,
  ],
  [
    'spreading',
    /\b(acacia|baobab|reniala|flamboyant|jacaranda|umbrella|parasol|tamarind|tamarinier|kily|fig|figuier|ficus|nonoka|rain ?tree)\b/i,
  ],
  [
    'shrub',
    /\b(bush|shrub|buisson|arbuste|hedge|haie|hibiscus|bougainvill\w*|gardenia|rose|rosier|lantana|oleander|laurier|fern|foug[eè]re|kirihitra)\b/i,
  ],
];

/** The habit a plant's name says, or null when it names none. */
export function habitFromLabel(label: string): PlantHabit | null {
  for (const [habit, re] of NAMES) if (re.test(label)) return habit;
  return null;
}

/** Fan palms: their leaves are palmate fans, not feathers. */
const FAN_PALMS =
  /\b(fan ?palms?|palmier [àa] [ée]ventail|satrana|bismarckia|latania|washingtonia|chamaerops|trachycarpus|sabal|livistona|borassus|hyphaene|copernicia|corypha|dypsis decaryi|triangle palm)\b/i;

/** The leaf type a plant's name says (a fan palm's fans), or null. */
export function leafFromLabel(label: string): LeafType | null {
  return FAN_PALMS.test(label) ? 'palmate' : null;
}

/** The leaves a habit carries unless the team says otherwise. */
export const HABIT_LEAF: Record<PlantHabit, LeafType> = {
  round: 'broad',
  spreading: 'broad',
  weeping: 'broad',
  columnar: 'scale',
  conical: 'needle',
  palm: 'frond',
  fan: 'blade',
  shrub: 'broad',
  grass: 'blade',
  rosette: 'blade',
  cactus: 'none',
  bamboo: 'blade',
};

/** Shape measures `habitFromShape` reads: shares of the drawing's height and width. */
export interface ShapeCues {
  /** No trunk shows under the crown. */
  bush: boolean;
  /** Crown height over the plant's height, its widest over its height. */
  crownHeight: number;
  aspect: number;
  /** Row of the crown's widest point, 0 = its top, 1 = its base. */
  widestAt: number;
}

/**
 * The habit the drawing's outline suggests when nobody named it: a crown widest near its base and
 * taller than wide is a conifer; one much taller than wide a column; one much wider than tall an
 * umbrella; no trunk a shrub; else a round crown.
 */
export function habitFromShape(c: ShapeCues): PlantHabit {
  if (c.bush) return 'shrub';
  if (c.aspect < 0.45) return 'columnar';
  if (c.widestAt > 0.72 && c.aspect < 0.95 && c.crownHeight > 0.5) return 'conical';
  if (c.aspect > 1.6) return 'spreading';
  return 'round';
}
