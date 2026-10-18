import type { CastDevice } from "../../../../services/cast-store";
import {
  castAndPlay,
  castPromptView,
  createCastPrompt,
  playAction,
  playVerb,
} from "../play-action";

const tv = (id: string, name = id): CastDevice => ({ id, name, type: "chromecast" });

describe("playAction: what Play (or Rejoin) does", () => {
  it("cast: a TV game starts right away, no prompt", () => {
    expect(playAction({ tv: "required" }, true)).toEqual({ kind: "start" });
    expect(playAction({ tv: "optional" }, true)).toEqual({ kind: "start" });
  });

  it("not cast: a TV-required game asks to cast first, with no phone option", () => {
    expect(playAction({ tv: "required" }, false)).toEqual({ kind: "promptCast", phone: false });
  });

  it("not cast: a game that can also play here asks to cast and offers this phone", () => {
    expect(playAction({ tv: "optional" }, false)).toEqual({ kind: "promptCast", phone: true });
  });

  it("a phone-only game plays on this phone, cast or not", () => {
    expect(playAction({ tv: "none" }, false)).toEqual({ kind: "playOnPhone" });
    expect(playAction({ tv: "none" }, true)).toEqual({ kind: "playOnPhone" });
  });
});

describe("playVerb: the button's word", () => {
  it("Rejoin when there's a sitting to go back to, else Play", () => {
    expect(playVerb(true)).toBe("Rejoin");
    expect(playVerb(false)).toBe("Play");
  });
});

describe("castPromptView: what the cast prompt shows", () => {
  it("lists the TVs found, the first one chosen", () => {
    const a = tv("a");
    const b = tv("b");
    expect(
      castPromptView({ devices: [a, b], searching: true, picked: null, stopped: null }),
    ).toEqual({ kind: "choose", devices: [a, b], target: a });
  });

  it("the TV you picked stays chosen", () => {
    const a = tv("a");
    const b = tv("b");
    expect(castPromptView({ devices: [a, b], searching: false, picked: b, stopped: null })).toEqual(
      { kind: "choose", devices: [a, b], target: b },
    );
  });

  it("prefers the TV this phone just stopped casting to", () => {
    const a = tv("a");
    const b = tv("b", "Bedroom TV");
    const view = castPromptView({
      devices: [a, b],
      searching: false,
      picked: null,
      stopped: { id: "b", name: "Bedroom TV" },
    });
    expect(view).toEqual({ kind: "choose", devices: [a, b], target: b });
  });

  it("says it's looking while the search runs and nothing is found yet", () => {
    expect(castPromptView({ devices: [], searching: true, picked: null, stopped: null })).toEqual({
      kind: "looking",
    });
  });

  it("says no TV was found once the search ends empty", () => {
    expect(castPromptView({ devices: [], searching: false, picked: null, stopped: null })).toEqual({
      kind: "noTv",
    });
  });
});

describe("castAndPlay: the prompt's Cast, then the game starts by itself", () => {
  it("casts to the TV, waits for the launcher, then plays", async () => {
    const calls: string[] = [];
    const result = await castAndPlay(tv("a"), {
      castNow: async (d) => {
        calls.push(`cast ${d.id}`);
        return "started";
      },
      waitForCast: async (ms) => {
        calls.push(`wait ${ms}`);
        return true;
      },
      play: () => calls.push("play"),
    });
    expect(result).toBe("played");
    expect(calls).toEqual(["cast a", "wait 8000", "play"]);
  });

  it("the TV never answers: no play", async () => {
    const play = jest.fn();
    const result = await castAndPlay(tv("a"), {
      castNow: async () => "no-tv",
      waitForCast: async () => true,
      play,
    });
    expect(result).toBe("no-answer");
    expect(play).not.toHaveBeenCalled();
  });

  it("the cast starts but the launcher never comes up: no play", async () => {
    const play = jest.fn();
    const result = await castAndPlay(tv("a"), {
      castNow: async () => "started",
      waitForCast: async () => false,
      play,
    });
    expect(result).toBe("no-answer");
    expect(play).not.toHaveBeenCalled();
  });
});

describe("createCastPrompt: the one cast prompt the app shows", () => {
  const request = (name: string) => ({
    game: { name },
    phone: false,
    play: () => {},
  });

  it("starts closed", () => {
    expect(createCastPrompt().get()).toBeNull();
  });

  it("ask opens it with the request and tells listeners; dismiss closes it", () => {
    const prompt = createCastPrompt();
    const seen: Array<string | null> = [];
    prompt.subscribe(() => seen.push(prompt.get()?.game.name ?? null));
    const r = request("Rocket Crew");
    prompt.ask(r);
    expect(prompt.get()).toBe(r);
    prompt.dismiss();
    expect(prompt.get()).toBeNull();
    expect(seen).toEqual(["Rocket Crew", null]);
  });

  it("dismissing a closed prompt tells no one", () => {
    const prompt = createCastPrompt();
    const listener = jest.fn();
    prompt.subscribe(listener);
    prompt.dismiss();
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops the updates", () => {
    const prompt = createCastPrompt();
    const listener = jest.fn();
    const off = prompt.subscribe(listener);
    off();
    prompt.ask(request("Bake Shop"));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("castPromptView after the app restarted (the second visit)", () => {
  const living = { id: "tv-1", name: "Living room TV", type: "chromecast" as const };
  const laptop = { id: "screen:abc", name: "Browser TV", type: "browser" as const };
  it("aims Cast at the TV this phone cast to last, not the first one found", () => {
    const view = castPromptView({
      devices: [living, laptop],
      searching: false,
      picked: null,
      stopped: null,
      last: { id: "screen:abc", name: "Browser TV" },
    });
    expect(view).toEqual({ kind: "choose", devices: [living, laptop], target: laptop });
  });
});
