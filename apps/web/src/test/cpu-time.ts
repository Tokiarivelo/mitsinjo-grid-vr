/**
 * CPU time used by this test worker so far, in milliseconds (user + system). Time budgets in tests are
 * measured with it, not the wall clock: when the full suite runs, other test files take the CPU and the
 * wall clock of a 300 ms computation was seen above 1000 ms, while its CPU time barely moves. Needs the
 * `forks` pool (one process per test file, Vitest's default); sharp's worker threads are counted.
 */
export function cpuMs(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}
