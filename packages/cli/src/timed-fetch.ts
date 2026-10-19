import { CliError } from "./io";

/**
 * fetch with a time limit, so no command hangs on a URL that never answers (doctor's TV page, a
 * developer's start URL, the API itself). A caller's own signal still aborts it.
 */
export function timedFetch(base: typeof fetch, ms: number): typeof fetch {
  return async (input, init) => {
    const limit = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
    try {
      return await base(input, { ...init, signal });
    } catch (e) {
      if (!limit.aborted) throw e;
      const url = input instanceof Request ? input.url : String(input);
      throw new CliError(`${url} didn't answer within ${ms / 1000} s`);
    }
  };
}
