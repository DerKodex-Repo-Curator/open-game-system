import { fakeContext } from "../__fixtures__/fake-context";
import type { CastBackend } from "../cast-backend";
import type { CastDevice } from "../cast-store";
import { castGameStores } from "../cast-stores";

jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

const TV: CastDevice = { id: "tv-1", name: "Living Room TV", type: "chromecast" };
const none = { remove: () => {} };

describe("castGameStores and the picker", () => {
  it("the picker lists the TVs the backend already knows", () => {
    const backend: CastBackend = {
      sessionManager: {
        getCurrentCastSession: async () => null,
        startSession: async () => true,
        endCurrentSession: async () => {},
        onSessionStarting: () => none,
        onSessionStarted: () => none,
        onSessionStartFailed: () => none,
        onSessionSuspended: () => none,
        onSessionResumed: () => none,
        onSessionEnded: () => none,
      },
      startDiscovery: () => {},
      getDevices: () => [TV],
      subscribeDevices: () => () => {},
      showCastDialog: () => {},
    };
    const { ctx } = fakeContext(async () => new Response(null, { status: 204 }));
    castGameStores(backend, { streamServerUrl: "https://stream.test" })(ctx);
    expect(ctx.castPicker.getSnapshot().devices).toEqual([TV]);
  });
});
