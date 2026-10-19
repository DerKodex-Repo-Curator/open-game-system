/**
 * Keeps credentials out of the device log. The app's console reaches it in release builds
 * (Android logcat, iOS os_log), where bug reports, sysdiagnoses and attached tools can read it.
 * Release builds drop log/info/debug; every build blanks tokens in what it still logs.
 */
const REDACTED = "<redacted>";

const PATTERNS: [RegExp, string][] = [
  // JWTs (OGS game and launcher tokens), whole or cut short.
  [/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}/g, REDACTED],
  [/(Bearer\s+)[^\s"',]+/g, `$1${REDACTED}`],
  [/Expo(?:nent)?PushToken\[[^\]]*\]/g, REDACTED],
  [/([?&](?:token|secret|access_token|id_token)=)[^&#\s"']+/g, `$1${REDACTED}`],
];

export function redact(text: string): string {
  return PATTERNS.reduce((out, [pattern, by]) => out.replace(pattern, by), text);
}

function safeArg(arg: unknown): unknown {
  if (typeof arg === "string") return redact(arg);
  if (arg instanceof Error) return redact(`${arg.name}: ${arg.message}`);
  if (typeof arg !== "object" || arg === null) return arg;
  try {
    return redact(JSON.stringify(arg));
  } catch {
    return String(arg);
  }
}

type LogFn = (...args: unknown[]) => void;
export interface ConsoleLike {
  log: LogFn;
  info: LogFn;
  debug: LogFn;
  warn: LogFn;
  error: LogFn;
}

export function installLogGuard(target: ConsoleLike, opts: { release: boolean }): void {
  const quiet: (keyof ConsoleLike)[] = ["log", "info", "debug"];
  for (const level of ["log", "info", "debug", "warn", "error"] as const) {
    if (opts.release && quiet.includes(level)) {
      target[level] = () => {};
      continue;
    }
    const write = target[level].bind(target);
    target[level] = (...args: unknown[]) => write(...args.map(safeArg));
  }
}
