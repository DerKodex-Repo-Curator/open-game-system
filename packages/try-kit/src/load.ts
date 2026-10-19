/**
 * try-kit's load-test runner: `rooms` rooms, `concurrency` at a time (the machine driving every
 * client is the limit, not the Worker: keep it modest), each one a function the game writes (a TV
 * and phones over real HTTP and WebSockets) that returns its timings in ms.
 */
export type LoadResult = {
  rooms: number;
  ok: number;
  /** Distinct failure messages (first 160 characters). */
  failures: string[];
  ms: Record<string, { p50: number; p95: number; max: number }>;
  wallMs: number;
};

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);
}

export async function runLoad(opts: { rooms: number; concurrency: number; room: () => Promise<Record<string, number>> }): Promise<LoadResult> {
  const started = performance.now();
  const settled: PromiseSettledResult<Record<string, number>>[] = [];
  for (let done = 0; done < opts.rooms; done += opts.concurrency) {
    const wave = Array.from({ length: Math.min(opts.concurrency, opts.rooms - done) }, () => opts.room());
    settled.push(...(await Promise.allSettled(wave)));
  }
  const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failures = [...new Set(settled.flatMap((r) => (r.status === "rejected" ? [String(r.reason).slice(0, 160)] : [])))];
  const keys = [...new Set(ok.flatMap((t) => Object.keys(t)))];
  const ms = Object.fromEntries(
    keys.map((k) => {
      const xs = ok.flatMap((t) => (typeof t[k] === "number" ? [t[k]] : []));
      return [k, { p50: percentile(xs, 0.5), p95: percentile(xs, 0.95), max: percentile(xs, 1) }];
    }),
  );
  return { rooms: opts.rooms, ok: ok.length, failures, ms, wallMs: Math.round(performance.now() - started) };
}
