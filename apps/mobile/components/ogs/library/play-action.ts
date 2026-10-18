import type { Manifest } from "@open-game-system/ogs-protocol";
import type { CastOutcome } from "../../../services/cast-flow";
import { createCastOnce } from "../../../services/cast-once";
import type { CastDevice } from "../../../services/cast-store";
import { hashId, newAttemptId } from "../../../services/client-log";
import { castTarget, type StoppedTv } from "../remote/last-stop";

/**
 * What Play (or Rejoin) does (owner, 2026-10-04: "it should just be Play, and then if they are not
 * already casting, we prompt them to cast"). Cast: start now. Not cast and the game uses the TV:
 * the cast prompt, which offers this phone too when the game can play here. Phone-only: play here.
 */
export type PlayAction =
  | { kind: "start" }
  | { kind: "playOnPhone" }
  | { kind: "promptCast"; phone: boolean };

export function playAction(game: Pick<Manifest, "tv">, cast: boolean): PlayAction {
  if (game.tv === "none") return { kind: "playOnPhone" };
  if (cast) return { kind: "start" };
  return { kind: "promptCast", phone: game.tv === "optional" };
}

/** The primary button's word for a game: Rejoin a sitting you're in, else Play. */
export const playVerb = (hasSitting: boolean): "Rejoin" | "Play" =>
  hasSitting ? "Rejoin" : "Play";

/** What the cast prompt shows: the TVs to pick from, "Looking for TVs…", or no TV found. */
export type CastPromptView =
  | { kind: "choose"; devices: CastDevice[]; target: CastDevice }
  | { kind: "looking" }
  | { kind: "noTv" };

export function castPromptView(input: {
  devices: CastDevice[];
  searching: boolean;
  picked: CastDevice | null;
  stopped: StoppedTv | null;
  /** The TV this phone cast to last (kept across launches). */
  last?: StoppedTv | null;
}): CastPromptView {
  const target = castTarget(input.devices, input.picked, input.stopped, input.last ?? null);
  if (target) return { kind: "choose", devices: input.devices, target };
  return input.searching ? { kind: "looking" } : { kind: "noTv" };
}

/** How long Cast waits for the TV to show the OGS launcher before it gives up. */
export const CAST_WAIT_MS = 8000;

/**
 * Cast, then play: cast the launcher to `tv`, wait until the TV is cast through OGS, then play.
 * "no-answer": the TV couldn't be reached or nothing came up in time. "busy": Cast refused the
 * start because another cast is up (not a TV that didn't answer).
 */
export async function castAndPlay(
  tv: CastDevice,
  deps: {
    castNow: (tv: CastDevice) => Promise<CastOutcome>;
    waitForCast: (ms: number) => Promise<boolean>;
    play: () => void;
  },
): Promise<"played" | "no-answer" | "busy"> {
  const result = await deps.castNow(tv);
  if (result === "refused-session-active") return "busy";
  if (result !== "started" || !(await deps.waitForCast(CAST_WAIT_MS))) return "no-answer";
  deps.play();
  return "played";
}

/** The prompt's log (cast.prompt.*): ids and enums only. */
export type PromptLog = (
  name: "prompt.shown" | "prompt.confirmed" | "prompt.dismissed" | "prompt.error",
  data: Record<string, string | boolean>,
  level?: "warn",
) => void;

/** What the prompt says when a Cast fails, and the key the log names it by. */
export function castPromptError(
  result: "no-answer" | "busy",
  tvName: string,
): { copyKey: "no-answer" | "busy"; text: string } {
  return result === "busy"
    ? { copyKey: "busy", text: "Another cast is still running. Try again in a moment." }
    : { copyKey: "no-answer", text: `${tvName} didn't answer. Is it on?` };
}

/**
 * The prompt's Cast: logs the tap (with the prompt's id, which the cast attempt carries too), casts
 * and plays, and returns what to say if it failed (null when it played), logging why.
 */
export async function confirmCast(
  tv: CastDevice,
  deps: {
    promptId: string;
    castNow: (tv: CastDevice, logData: { promptId: string }) => Promise<CastOutcome>;
    waitForCast: (ms: number) => Promise<boolean>;
    play: () => void;
    log: PromptLog;
    errorText: (err: unknown) => string;
  },
): Promise<string | null> {
  const base = { promptId: deps.promptId, tv: hashId(tv.id) };
  deps.log("prompt.confirmed", base);
  let outcome: CastOutcome | null = null;
  let result: "played" | "no-answer" | "busy";
  try {
    result = await castAndPlay(tv, {
      castNow: async (t) => {
        outcome = await deps.castNow(t, { promptId: deps.promptId });
        return outcome;
      },
      waitForCast: deps.waitForCast,
      play: deps.play,
    });
  } catch (err) {
    deps.log("prompt.error", { ...base, reason: "error", copyKey: "user-message" }, "warn");
    return deps.errorText(err);
  }
  if (result === "played") return null;
  const error = castPromptError(result, tv.name);
  const reason = outcome === "started" ? "launcher-timeout" : (outcome ?? "unknown");
  deps.log("prompt.error", { ...base, reason, copyKey: error.copyKey }, "warn");
  return error.text;
}

/** A Play that needs the TV: which game, whether it can play here instead, and how to play it. */
export interface CastPromptRequest {
  game: Pick<Manifest, "name">;
  phone: boolean;
  play: () => void;
}

/** How the prompt closed: Not now (or the scrim, or back), Play on this phone, or cast and played. */
export type PromptClose = "not-now" | "phone" | "played";
const CLOSES: readonly string[] = ["not-now", "phone", "played"] satisfies PromptClose[];
const isClose = (how: unknown): how is PromptClose =>
  typeof how === "string" && CLOSES.includes(how);

/**
 * The app's one cast prompt: any Play asks it, the sheet mounted over the tabs shows it. Each time
 * it opens it gets an id, logged with shown / confirmed / dismissed / error and carried by the cast
 * attempt it starts.
 */
export function createCastPrompt(opts: { log?: PromptLog } = {}) {
  let current: CastPromptRequest | null = null;
  let id: string | null = null;
  const log: PromptLog = (name, data, level) => opts.log?.(name, data, level);
  const confirmOnce = createCastOnce<string | null>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    get: (): CastPromptRequest | null => current,
    /** The open prompt's id (null when closed). */
    promptId: () => id,
    /** The prompt's log (the sheet logs its Cast's outcome through it). */
    log,
    /** Its Cast, one at a time: a second tap while one runs shares it (no second cast or play). */
    confirm: (run: () => Promise<string | null>) => confirmOnce.run(run),
    ask(request: CastPromptRequest) {
      current = request;
      id = newAttemptId();
      log("prompt.shown", { promptId: id, phone: request.phone });
      emit();
    },
    /** Closes it; `how` defaults to Not now (a press event passed straight in counts as one). */
    dismiss(how?: unknown) {
      if (!current) return;
      log("prompt.dismissed", { promptId: id ?? "", how: isClose(how) ? how : "not-now" });
      current = null;
      id = null;
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type CastPrompt = ReturnType<typeof createCastPrompt>;
