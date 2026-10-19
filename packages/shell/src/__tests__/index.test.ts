import * as clientLog from "../client-log";
import * as gameUrlStore from "../game-url-store";
import * as shell from "../index";

// One module instance either way: "@open-game-system/shell" re-exports the per-file modules.
describe("@open-game-system/shell runtime entry", () => {
  it("re-exports the per-file modules themselves", () => {
    expect(shell.createClientLog).toBe(clientLog.createClientLog);
    expect(shell.setGameUrl).toBe(gameUrlStore.setGameUrl);
  });

  it("loads under jest-expo from TypeScript source", () => {
    shell.setGameUrl("https://rocketcrew.tv/play");
    expect(shell.consumePendingGameUrl()).toBe("https://rocketcrew.tv/play");
    expect(shell.consumePendingGameUrl()).toBeNull();
  });
});
