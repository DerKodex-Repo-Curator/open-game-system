import { installLogGuard, redact } from "../log-guard";

// The app's console reaches the device log in release builds (Android logcat, iOS os_log), which
// other apps, bug reports and sysdiagnoses can read. So release builds drop the chatty levels, and
// every build blanks tokens in what it still logs.
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJkYW5hIn0.c2lnbmF0dXJlLWJ5dGVz";

describe("redact", () => {
  it.each([
    [`profile {"token":"${JWT}"}`, `profile {"token":"<redacted>"}`],
    [`Authorization: Bearer abc.def-123`, "Authorization: Bearer <redacted>"],
    ["push ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] ok", "push <redacted> ok"],
    [
      "https://ogs-tv.pages.dev/?api=https%3A%2F%2Fx&token=abc.def&room=7",
      "https://ogs-tv.pages.dev/?api=https%3A%2F%2Fx&token=<redacted>&room=7",
    ],
    ["/screens/1?secret=s3cr3t", "/screens/1?secret=<redacted>"],
    [`a half token eyJhbGciOiJFUzI1NiJ9.eyJzdWIi`, "a half token <redacted>"],
  ])("%s", (input, out) => {
    expect(redact(input)).toBe(out);
  });

  it("leaves ordinary text alone", () => {
    const text = "Cast to Living room (screen:8458505f) failed: 404 not found";
    expect(redact(text)).toBe(text);
  });
});

function fakeConsole() {
  const seen: { level: string; args: unknown[] }[] = [];
  const at =
    (level: string) =>
    (...args: unknown[]) => {
      seen.push({ level, args });
    };
  return {
    seen,
    target: {
      log: at("log"),
      info: at("info"),
      debug: at("debug"),
      warn: at("warn"),
      error: at("error"),
    },
  };
}

describe("installLogGuard", () => {
  it("release: log, info and debug say nothing", () => {
    const { seen, target } = fakeConsole();
    installLogGuard(target, { release: true });
    target.log("[Native Bridge] state", { token: JWT });
    target.info("hello");
    target.debug("detail");
    expect(seen).toEqual([]);
  });

  it("release: warn and error still report, with tokens blanked in strings, objects and errors", () => {
    const { seen, target } = fakeConsole();
    installLogGuard(target, { release: true });
    target.warn("[ogs] game token failed for", { token: JWT, id: "rocket-crew" });
    target.error("[ogs] failed:", new Error(`bad token ${JWT}`));
    const text = JSON.stringify(seen);
    expect(seen.map((s) => s.level)).toEqual(["warn", "error"]);
    expect(text).not.toContain("eyJ");
    expect(text).toContain("rocket-crew");
    expect(text).toContain("bad token <redacted>");
  });

  it("development: every level still logs, tokens blanked", () => {
    const { seen, target } = fakeConsole();
    installLogGuard(target, { release: false });
    target.log("[Notifications] Push token:", "ExponentPushToken[abcdefghijklmnop]");
    target.info(`viewUrl ?token=${JWT}`);
    expect(seen.map((s) => s.level)).toEqual(["log", "info"]);
    expect(JSON.stringify(seen)).not.toMatch(/eyJ|ExponentPushToken/);
  });

  it("an object it can't serialise is logged as its kind, not dropped or thrown on", () => {
    const { seen, target } = fakeConsole();
    installLogGuard(target, { release: false });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => target.warn("loop", loop)).not.toThrow();
    expect(seen).toEqual([{ level: "warn", args: ["loop", "[object Object]"] }]);
  });
});

describe("the app installs it first", () => {
  it("the root layout's first import installs the guard", () => {
    // The mobile tsconfig has no Node types; jest runs from apps/mobile.
    const fs = jest.requireActual<{ readFileSync(path: string, encoding: "utf8"): string }>("fs");
    const layout = fs.readFileSync("app/_layout.tsx", "utf8");
    expect(layout.split("\n")[0]).toBe('import "../services/log-guard-install";');
  });
});
