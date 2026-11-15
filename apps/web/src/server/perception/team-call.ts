/**
 * One call of a reading team (the car team, the plant team): it ends with the request or at its
 * own deadline, whichever comes first, and never throws (a failure is logged, the answer is null).
 */
export async function callWithDeadline(
  tag: string,
  tool: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<string | null>
): Promise<string | null> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const both = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const stop = () =>
        reject(new Error(`${tool}: no answer in ${Math.round(timeoutMs / 1000)} s`));
      if (both.aborted) return stop();
      both.addEventListener('abort', stop, { once: true });
      run(both).then(resolve, reject);
    });
  } catch (err) {
    console.warn(`${tag}: ${tool} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * The specialists of a team in parallel, then each unusable answer asked once more, alone (a call
 * cut by the network, or answering nothing usable).
 */
export async function askSpecialists<Tool extends string>(
  tag: string,
  tools: ReadonlyArray<Tool>,
  ask: (tool: Tool) => Promise<string | null>,
  answered: (tool: Tool, content: string | null | undefined) => boolean,
  signal?: AbortSignal
): Promise<Partial<Record<Tool, string | null>>> {
  const answers = Object.fromEntries(
    await Promise.all(tools.map(async (t) => [t, await ask(t)] as const))
  ) as Partial<Record<Tool, string | null>>;
  for (const tool of tools) {
    if (answered(tool, answers[tool]) || signal?.aborted) continue;
    console.info(`${tag}: ${tool} unusable, asked again`);
    answers[tool] = await ask(tool);
  }
  return answers;
}
