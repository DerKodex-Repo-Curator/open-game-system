import { ClaimsSchema } from "@open-game-system/ogs-protocol";
import { z } from "zod";
import { VIEW_TIMEOUT_MS } from "./launcher/starting";

/** `/?api=<API base>&token=<launcher JWT>`, or `/?fake=1` for an in-browser session. */
const LiveSchema = z.object({
  api: z
    .string()
    .url()
    .transform((u) => u.replace(/\/+$/, "")),
  token: z.string().min(1),
});

/**
 * `chrome=none&app=<appId>`: a white-label app's cast (docs/acceptance/2026-10-18-cast-chrome-none.feature):
 * the game's TV page full screen, with no launcher around it. Present only then.
 */
export type Chrome = { chrome?: { appId: string } };

export type LauncherParams =
  | ({ mode: "fake"; hold: boolean; fresh?: true } & Chrome)
  | ({ mode: "live"; api: string; token: string; sessionId: string } & Chrome);

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The chrome part of the URL: nothing, `{ chrome }`, or an error for chrome=none without a valid app. */
function chromeOf(q: URLSearchParams): Chrome | { error: string } {
  if (q.get("chrome") !== "none") return {};
  const appId = q.get("app") ?? "";
  return APP_ID.test(appId) ? { chrome: { appId } } : { error: "app: required with chrome=none" };
}

/** A positive millisecond knob from the URL, else its default. */
function msKnob(search: string, name: string, fallback: number): number {
  const n = Number(new URLSearchParams(search).get(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Knobs for tests and design: how long a frame may take to load before the launcher gives up. */
export function frameTimeoutMs(search: string): number {
  return msKnob(search, "frameTimeout", 20_000);
}

/** How long a started game may take to send its TV page (game.view) before the TV says it didn't open. */
export function viewTimeoutMs(search: string): number {
  return msKnob(search, "viewTimeout", VIEW_TIMEOUT_MS);
}
export type ParamsResult = { ok: true; params: LauncherParams } | { ok: false; error: string };

export function parseParams(search: string): ParamsResult {
  const q = new URLSearchParams(search);
  const chrome = chromeOf(q);
  if ("error" in chrome) return { ok: false, error: chrome.error };
  if (q.get("fake") === "1") {
    const hold = q.get("hold") === "1";
    // `world=fresh`: a couch before anyone has played anything (design and tests).
    const params: LauncherParams =
      q.get("world") === "fresh" ? { mode: "fake", hold, fresh: true, ...chrome } : { mode: "fake", hold, ...chrome };
    return { ok: true, params };
  }
  const r = LiveSchema.safeParse({
    api: q.get("api") ?? undefined,
    token: q.get("token") ?? undefined,
  });
  if (!r.success)
    // Stryker disable next-line StringLiteral: equivalent, LiveSchema is flat so every issue path has one key
    return { ok: false, error: r.error.issues.map((i) => i.path.join(".")).join(", ") };
  const sessionId = launcherSessionOf(r.data.token);
  if (!sessionId) return { ok: false, error: "token: not a launcher token" };
  return { ok: true, params: { mode: "live", ...r.data, sessionId, ...chrome } };
}

export function wsUrl(api: string, token: string): string {
  const base = api.replace(/^http/, "ws");
  return `${base}/api/v1/couch/ws?token=${encodeURIComponent(token)}`;
}

function decodeSegment(seg: string): unknown {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  // Stryker disable next-line StringLiteral,ArithmeticOperator: equivalent, atob() accepts unpadded base64 (WHATWG forgiving-base64)
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** The couch session a launcher token is for (its `sid` claim). Not verified here: the API does that. */
export function launcherSessionOf(token: string): string | null {
  const seg = token.split(".")[1];
  // Stryker disable next-line ConditionalExpression: equivalent, decoding a missing or empty segment throws and is caught below
  if (!seg) return null;
  try {
    const claims = ClaimsSchema.safeParse(decodeSegment(seg));
    // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent, ClaimsSchema already ties sid to kind launcher
    return claims.success && claims.data.kind === "launcher" ? (claims.data.sid ?? null) : null;
  } catch {
    return null;
  }
}
