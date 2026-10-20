import { startPushRegistration } from "../push-registration";

describe("startPushRegistration with no device id yet", () => {
  it("stops cleanly though it never listened", () => {
    const stop = startPushRegistration({
      deviceId: () => null,
      subscribe: () => () => {},
      register: async () => {},
      listen: () => ({ remove: () => {} }),
    });
    expect(() => stop()).not.toThrow();
  });
});
