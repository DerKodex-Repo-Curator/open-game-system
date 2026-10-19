import { clockOffset, shiftClock } from "../e2e-clock";

// The second-visit e2e moves the phone's clock a day forward (Detox passes the offset as a launch
// argument; only builds with EXPO_PUBLIC_E2E_CLOCK=1 read it).
describe("e2e clock", () => {
  it("reads the offset: a whole number of milliseconds, else none", () => {
    expect(clockOffset("86400000")).toBe(86_400_000);
    expect(clockOffset(86_400_000)).toBe(86_400_000);
    for (const v of [undefined, null, "", "soon", "1.5", {}]) expect(clockOffset(v)).toBe(0);
  });

  it("moves Date.now forward and back again", () => {
    const real = Date.now;
    const before = Date.now();
    const restore = shiftClock(86_400_000);
    try {
      expect(Date.now() - before).toBeGreaterThanOrEqual(86_400_000);
      expect(Date.now() - before).toBeLessThan(86_400_000 + 5_000);
    } finally {
      restore();
    }
    expect(Date.now).toBe(real);
  });

  it("no offset leaves the clock alone", () => {
    const real = Date.now;
    shiftClock(0)();
    expect(Date.now).toBe(real);
  });
});
