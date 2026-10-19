import { createScreenCastBackend, type ScreensApi } from "../screen-cast";

// A single-game app casts the launcher with chrome=none&app=<appId>: a browser TV must be told the
// app too, or it would show the whole launcher.
function setup() {
  const shows: unknown[][] = [];
  const api: ScreensApi = {
    claim: async () => ({ screenId: "sc1", name: "Browser TV" }),
    show: async (...args) => {
      shows.push(args);
    },
    stop: async () => {},
  };
  const data: Record<string, string> = {};
  const screens = createScreenCastBackend({
    api,
    storage: {
      getItem: async (k) => data[k] ?? null,
      setItem: async (k, v) => {
        data[k] = v;
      },
    },
  });
  return { screens, shows };
}

async function sendLoadView(viewUrl: string) {
  const { screens, shows } = setup();
  await screens.ready;
  await screens.addScreen("KQTP7X");
  await screens.sessionManager.startSession("screen:sc1");
  const session = await screens.sessionManager.getCurrentCastSession();
  const channel = await session?.addChannel("urn:x-cast:org.opengame.view");
  await channel?.sendMessage(JSON.stringify({ type: "LOAD_VIEW", viewUrl }));
  return shows;
}

describe("a browser TV and chrome=none", () => {
  it("passes the app of a chromeless launcher", async () => {
    expect(
      await sendLoadView(
        "https://tv.test/?api=https%3A%2F%2Fapi.test&token=t1&chrome=none&app=rocket-crew",
      ),
    ).toEqual([["sc1", "t1", "rocket-crew"]]);
  });

  it("sends only the token for the OGS app's launcher (unchanged)", async () => {
    expect(await sendLoadView("https://tv.test/?api=https%3A%2F%2Fapi.test&token=t1")).toEqual([
      ["sc1", "t1"],
    ]);
  });

  it("ignores app without chrome=none", async () => {
    expect(
      await sendLoadView("https://tv.test/?api=https%3A%2F%2Fapi.test&token=t1&app=rocket-crew"),
    ).toEqual([["sc1", "t1"]]);
  });
});
