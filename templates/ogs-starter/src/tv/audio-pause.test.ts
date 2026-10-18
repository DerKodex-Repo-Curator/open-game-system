import { describe, expect, it } from "vitest";
import { createAudioPause } from "./audio-pause";

function fakeCtx(state: string) {
  const ctx = {
    state,
    suspend: async () => {
      ctx.state = "suspended";
    },
    resume: async () => {
      ctx.state = "running";
    },
  };
  return ctx;
}

describe("the parked-audio gate", () => {
  it("silences a running context when parked and brings it back on Continue", () => {
    const ctx = fakeCtx("running");
    const gate = createAudioPause(() => ctx);
    gate.setPaused(true);
    expect(ctx.state).toBe("suspended");
    gate.setPaused(false);
    expect(ctx.state).toBe("running");
  });

  it("does not start sound on Continue that was not playing before the pause", () => {
    const ctx = fakeCtx("suspended");
    const gate = createAudioPause(() => ctx);
    gate.setPaused(true);
    gate.setPaused(false);
    expect(ctx.state).toBe("suspended");
  });
});
