import 'server-only';

/**
 * Contributor models: same Spark model, up to 95 % cheaper, but Meta trains on inputs and outputs and
 * rate-limits them by tokens. Preferred when `META_PREFER_CONTRIBUTOR` is on; any refusal falls back to
 * the standard id, and the contributor id rests for a while so later calls skip it.
 */

/** Spark versions the catalogue offers in contributor mode. */
const CONTRIBUTOR_BASES = new Set(['muse-spark-1.2', 'muse-spark-1.3']);

/** Refusals worth retrying on the standard model: forbidden (country/access), unknown model, rate limit. */
export const CONTRIBUTOR_FALLBACK_STATUSES = new Set([403, 404, 429]);

const RATE_LIMIT_PAUSE_MS = 60_000;
const ACCESS_PAUSE_MS = 60 * 60_000;

const pausedUntil = new Map<string, number>();

export function contributorVariant(model: string): string | null {
  return CONTRIBUTOR_BASES.has(model) ? `${model}-contributor` : null;
}

export function isContributorModel(model: string): boolean {
  return model.endsWith('-contributor');
}

/** Model id to send: the contributor variant when preferred, available and not paused. */
export function chooseModel(base: string, preferContributor: boolean, now = Date.now()): string {
  const variant = preferContributor ? contributorVariant(base) : null;
  if (!variant) return base;
  return (pausedUntil.get(variant) ?? 0) > now ? base : variant;
}

export function pauseContributor(model: string, status: number, now = Date.now()): void {
  pausedUntil.set(model, now + (status === 429 ? RATE_LIMIT_PAUSE_MS : ACCESS_PAUSE_MS));
}

/** Test helper. */
export function resetContributorPauses(): void {
  pausedUntil.clear();
}

/**
 * Sends a request with the preferred model; on a contributor refusal, pauses it and resends once with
 * the standard id. Returns the response and the model that answered (for the spend guard).
 */
export async function fetchPreferringContributor(
  base: string,
  preferContributor: boolean,
  send: (model: string) => Promise<Response>
): Promise<{ res: Response; model: string }> {
  // A contributor id chosen on purpose (3D step defaults): its standard id is the fallback.
  const chosen = isContributorModel(base);
  const standard = chosen ? base.slice(0, -'-contributor'.length) : base;
  const model = chosen
    ? (pausedUntil.get(base) ?? 0) > Date.now()
      ? standard
      : base
    : chooseModel(base, preferContributor);
  const res = await send(model);
  if (res.ok || model === standard || !CONTRIBUTOR_FALLBACK_STATUSES.has(res.status)) {
    return { res, model };
  }
  console.warn(
    `[copilot:contributor] ${model} refused (${res.status}); retrying with ${standard} and pausing it`
  );
  pauseContributor(model, res.status);
  return { res: await send(standard), model: standard };
}
