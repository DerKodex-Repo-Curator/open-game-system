import { LoginSchema, OgsApiError } from "../api-request";
import { createGameProfile, type GameGrant, REFRESH_MARGIN_MS } from "../game-profile";

const grant = (token: string, expiresAt: number): GameGrant => ({
  token,
  expiresAt,
  profile: { id: "g", handle: "player", name: "Player", avatar: "https://art.test/owl.webp" },
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("game profile, edges", () => {
  it("retries a failed refresh after exactly a minute", async () => {
    jest.useFakeTimers({ now: 0 });
    const asked: number[] = [];
    let fail = false;
    const profile = createGameProfile({
      fetchToken: async () => {
        asked.push(Date.now());
        if (fail) throw new Error("offline");
        return grant("t", REFRESH_MARGIN_MS + 1000);
      },
    });
    profile.open("rocket-crew");
    await jest.advanceTimersByTimeAsync(0);
    fail = true;
    await jest.advanceTimersByTimeAsync(1000);
    expect(asked).toEqual([0, 1000]);
    await jest.advanceTimersByTimeAsync(59_999);
    expect(asked).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(asked).toEqual([0, 1000, 61_000]);
    profile.close();
  });

  it("closing stops the refresh", async () => {
    jest.useFakeTimers({ now: 0 });
    const fetchToken = jest.fn(async () => grant("t", REFRESH_MARGIN_MS + 1000));
    const profile = createGameProfile({ fetchToken });
    profile.open("rocket-crew");
    await jest.advanceTimersByTimeAsync(0);
    profile.close();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("an answer that comes after the game closed is dropped", async () => {
    let answer: (g: GameGrant) => void = () => {};
    const profile = createGameProfile({
      fetchToken: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    profile.open("rocket-crew");
    profile.close();
    answer(grant("late", Date.now() + 3_600_000));
    await new Promise((r) => setTimeout(r, 0));
    expect(profile.store.getSnapshot()).toEqual({ status: "none" });
  });

  it("the not-listed note says the page gets no profile until the game is listed", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    const profile = createGameProfile({
      fetchToken: async () => {
        throw new OgsApiError("game_not_found", "No game", 404);
      },
    });
    profile.open("my-game");
    await new Promise((r) => setTimeout(r, 0));
    expect(info.mock.calls[0]?.[0]).toContain(
      "(as in a plain browser). Profiles start once the game is listed: ",
    );
  });
});

describe("LoginSchema", () => {
  it("takes Apple, Google and email logins", () => {
    for (const provider of ["apple", "google", "email"]) {
      expect(LoginSchema.safeParse({ provider, email: null }).success).toBe(true);
    }
    expect(LoginSchema.safeParse({ provider: "facebook", email: null }).success).toBe(false);
  });
});

describe("game profile, a failure after close", () => {
  it("is not reported", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    let fail: (e: Error) => void = () => {};
    const profile = createGameProfile({
      fetchToken: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });
    profile.open("rocket-crew");
    profile.close();
    fail(new Error("offline"));
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).not.toHaveBeenCalled();
  });
});
