import { subscribeHardwareBack } from "../hardware-back";

describe("subscribeHardwareBack", () => {
  it("listens to Android's hardwareBackPress", () => {
    const events: string[] = [];
    subscribeHardwareBack(
      {
        addEventListener: (event) => {
          events.push(event);
          return { remove: () => {} };
        },
      },
      () => {},
    );
    expect(events).toEqual(["hardwareBackPress"]);
  });
});
