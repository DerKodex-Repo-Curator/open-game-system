import { OgsApiError } from "../api-request";
import { createGameProfile } from "../game-profile";

/**
 * A new app's game is often not in the OGS catalogue yet. The page then gets no profile (as in a
 * plain browser); the developer's log says why and what to do, without a warning that looks like
 * an error.
 */
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

function setup(error: unknown) {
  const info = jest.spyOn(console, "info").mockImplementation(() => {});
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const profile = createGameProfile({
    fetchToken: async () => {
      throw error;
    },
  });
  return { profile, info, warn };
}

afterEach(() => jest.restoreAllMocks());

describe("a game that isn't in the OGS catalogue", () => {
  it("gets no profile, and the log names the app id, the cause and the docs", async () => {
    const { profile, info, warn } = setup(
      new OgsApiError("game_not_found", "No game with that appId", 404),
    );
    profile.open("my-game");
    await until(() => info.mock.calls.length > 0);
    expect(profile.store.getSnapshot()).toEqual({ status: "none" });
    expect(warn).not.toHaveBeenCalled();
    const [message] = info.mock.calls[0] ?? [];
    expect(message).toContain('"my-game"');
    expect(message).toMatch(/not in the OGS catalogue/);
    expect(message).toMatch(/profile null/);
    expect(message).toContain(
      "https://ogs-docs.pages.dev/art-and-catalogue#submit-to-the-catalogue",
    );
    profile.close();
  });

  it("any other failure is still a warning with the error", async () => {
    const error = new OgsApiError("OFFLINE", "The OGS API can't be reached", 0);
    const { profile, info, warn } = setup(error);
    profile.open("rocket-crew");
    await until(() => warn.mock.calls.length > 0);
    expect(warn).toHaveBeenCalledWith("[ogs] no game token for", "rocket-crew", error);
    expect(info).not.toHaveBeenCalled();
    profile.close();
  });
});
