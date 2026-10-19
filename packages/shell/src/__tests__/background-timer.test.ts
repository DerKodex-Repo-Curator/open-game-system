import { backgroundTimeout, unrefTimer } from "../background-timer";

describe("background timers (refreshes due in an hour)", () => {
  it("unrefTimer unrefs a timer that can be (Node, Jest), so it never keeps the process alive", () => {
    const timer = { unref: jest.fn() };
    unrefTimer(timer);
    expect(timer.unref).toHaveBeenCalledTimes(1);
  });

  it("unrefTimer leaves React Native's numeric timers and anything else alone", () => {
    expect(() => unrefTimer(42)).not.toThrow();
    expect(() => unrefTimer(null)).not.toThrow();
    expect(() => unrefTimer({ unref: "no" })).not.toThrow();
  });

  it("backgroundTimeout still fires, and clearTimeout cancels it", async () => {
    const fired: string[] = [];
    backgroundTimeout(() => fired.push("a"), 1);
    clearTimeout(backgroundTimeout(() => fired.push("b"), 1));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(fired).toEqual(["a"]);
  });
});
